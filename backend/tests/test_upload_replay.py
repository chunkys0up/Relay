from __future__ import annotations

from pathlib import Path
from typing import Any

import pypdf
import pytest

from app.workflow import documents
from app.workflow.repository import Repository, WorkflowError
from app.workflow.service import WorkflowService
from make_browser_fixtures import make_form


def test_source_retry_replays_without_reextracting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = WorkflowService(Repository(str(tmp_path / 'source.sqlite3')), None)
    state = service.create_case('owner', 'case', 'Studio', 'Prepare packet')
    calls = 0
    extract = documents.extract_document

    def counted_extract(
        data: bytes, filename: str, content_type: str, source_id: str,
    ) -> list[documents.Excerpt]:
        nonlocal calls
        calls += 1
        return extract(data, filename, content_type, source_id)

    monkeypatch.setattr(documents, 'extract_document', counted_extract)
    first = service.upload_source('owner', state['id'], 0, 'upload',
                                  'record.txt', 'text/plain', b'Company: Studio')
    assert service.upload_source('owner', state['id'], 0, 'upload',
                                 'record.txt', 'text/plain', b'Company: Studio') == first
    assert calls == 1
    assert service.snapshot('owner', state['id'])['revision'] == first['case_revision']
    with pytest.raises(WorkflowError, match='IDEMPOTENCY_CONFLICT'):
        service.upload_source('owner', state['id'], 0, 'upload',
                              'renamed.txt', 'text/plain', b'Company: Studio')
    assert calls == 1
    with pytest.raises(WorkflowError, match='FILE_TOO_LARGE'):
        service.upload_source('owner', state['id'], 0, 'upload',
                              'record.txt', 'text/plain', b'x' * (10 * 1024 * 1024 + 1))
    assert calls == 1


def test_template_retry_replays_without_reparsing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = WorkflowService(Repository(str(tmp_path / 'template.sqlite3')), None)
    state = service.create_case('owner', 'case', 'Studio', 'Prepare packet')
    form = tmp_path / 'form.pdf'
    make_form(form)
    data = form.read_bytes()
    calls = 0
    reader = pypdf.PdfReader

    def counted_reader(*args: Any, **kwargs: Any) -> pypdf.PdfReader:
        nonlocal calls
        calls += 1
        return reader(*args, **kwargs)

    monkeypatch.setattr(pypdf, 'PdfReader', counted_reader)
    first = service.upload_template('owner', state['id'], 0, 'upload', 'form.pdf', data)
    assert service.upload_template('owner', state['id'], 0, 'upload', 'form.pdf', data) == first
    assert calls == 1
    assert service.snapshot('owner', state['id'])['revision'] == first['case_revision']
    with pytest.raises(WorkflowError, match='IDEMPOTENCY_CONFLICT'):
        service.upload_template('owner', state['id'], 0, 'upload', 'renamed.pdf', data)
    assert calls == 1
