from __future__ import annotations

import hashlib
from typing import Any
from collections.abc import Callable

from .documents import fill_pdf_form, generate_packet_pdf
from .repository import Repository, WorkflowError
from .schemas import FIELDS, ModelResult
from .service import now, uid


def verify_rendered_pdf(pdf: bytes, fields: dict[str, str], template_fields: list[str] | None,
                        verifier: Callable[[bytes, dict[str, str], list[str] | None], dict[str, Any]] | None = None) -> dict[str, Any]:
    from .pdf_verification import inspect_pdf
    from .model import ModelFailure
    try:
        report = (verifier(pdf, fields, template_fields) if verifier else
                  inspect_pdf(pdf, fields, template_fields))
    except ValueError as exc:
        raise ModelFailure("PDF_VERIFICATION_FAILED") from exc
    digest = hashlib.sha256(pdf).hexdigest()
    if report.get('passed') is not True or report.get('hash') != digest:
        raise ModelFailure("PDF_VERIFICATION_FAILED")
    return {'passed': True, 'hash': digest,
            'mode': report.get('mode', 'deterministic'), 'checks': report.get('checks', [])}


def stage_edit(repo: Repository, owner: str, state: dict[str, Any], job_id: str,
               result: ModelResult, excerpts: list[dict[str, Any]],
               verifier: Callable[[bytes, dict[str, str], list[str] | None], dict[str, Any]] | None = None) -> None:
    from .model import validate_pdf_edit

    edit = validate_pdf_edit(result.pdf_edit, state, excerpts)
    if state['analysis_required'] and {p.field for p in edit.changes} != set(FIELDS):
        raise WorkflowError('NEEDS_SOURCE_REVIEW')
    version = len(state['packets']) + 1
    template_fields = None
    if edit.template_id:
        template = next(t for t in state['templates'] if t['id'] == edit.template_id)
        template_fields = template['fields']
        data = repo.blob(owner, state['id'], edit.template_id, 'template')
        pdf = fill_pdf_form(data, {k: edit.fields[k] for k in template['fields']})
    else:
        pdf = generate_packet_pdf(edit.fields, version)
    verification = verify_rendered_pdf(pdf, edit.fields, template_fields, verifier)
    action = {**edit.model_dump(), 'id': uid(), 'status': 'pending', 'version': version,
              'hash': hashlib.sha256(pdf).hexdigest(), 'created_at': now(),
              'created_revision': state['revision'] + 1,
              'current_packet_id': state['current_packet_id'], 'verification': verification}

    def finish(current: dict[str, Any], job: dict[str, Any]) -> None:
        if current['revision'] != state['revision'] or job['status'] != 'working':
            raise WorkflowError('STALE_REVISION')
        current.setdefault('pdf_actions', []).append(action)
        job['status'] = 'needs_input'
        job['agent_steps'] = [*result.agent_steps, {'role': 'verifier', 'status': 'done',
            'detail': 'Generated PDF verified; awaiting human confirmation.'}]
        current['ui_state'] = 'Needs input'
        current['activity'] = 'Review the proposed PDF. Nothing is saved until you confirm.'
        current['messages'].append({'id': uid(), 'author': 'Relay', 'created_at': now(),
            'text': result.reply or 'I prepared a PDF preview. Review and confirm to save a new version.'})
        for task in current['tasks']:
            if task['job_id'] == job_id:
                task['state'] = 'Done'
    repo.update_job(owner, state['id'], job_id, finish, [(action['id'], 'pdf_preview', pdf)])


def resolve_edit(repo: Repository, owner: str, case_id: str, action_id: str,
                 revision: int, preview_hash: str, key: str, *, dismiss: bool = False) -> dict[str, Any]:
    request = {'action_id': action_id, 'expected_revision': revision, 'preview_hash': preview_hash}
    operation = 'dismiss_pdf_edit' if dismiss else 'confirm_pdf_edit'
    prior = repo.replay(owner, case_id, operation, key, request)
    if prior is not None:
        return prior
    pdf = repo.blob(owner, case_id, action_id, 'pdf_preview')

    def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
        action = next((a for a in state.get('pdf_actions', []) if a['id'] == action_id), None)
        if action is None:
            raise WorkflowError('NOT_FOUND', 404)
        if action['status'] != 'pending':
            raise WorkflowError('ACTION_NOT_PENDING')
        if preview_hash != action['hash'] or hashlib.sha256(pdf).hexdigest() != preview_hash:
            raise WorkflowError('PREVIEW_MISMATCH')
        if dismiss:
            action['status'] = 'dismissed'
            state['activity'] = 'Proposed PDF dismissed; no document changed.'
            return {'action_id': action_id, 'status': 'dismissed'}, []
        verification = action.get('verification')
        if not isinstance(verification, dict) or verification.get('passed') is not True or verification.get('hash') != preview_hash or verification.get('mode') not in ('deterministic', 'deterministic+agent'):
            raise WorkflowError('PDF_VERIFICATION_FAILED')
        if action['created_revision'] != revision or action['current_packet_id'] != state['current_packet_id']:
            raise WorkflowError('STALE_PREVIEW')
        if any(j['status'] in ('queued', 'working') for j in state['jobs']):
            raise WorkflowError('JOB_IN_PROGRESS')
        if len(state['packets']) + 1 != action['version']:
            raise WorkflowError('STALE_PACKET')
        message_id = uid()
        fields = action['fields']
        text = '\n'.join(f'{name}: {fields[name]}' for name in FIELDS)
        state['messages'].append({'id': message_id, 'author': 'founder', 'text': text,
            'hash': hashlib.sha256(text.encode()).hexdigest(), 'created_at': now()})
        for field in FIELDS:
            state['facts'][field].update(state='confirmed', value=fields[field],
                confirmed_by='founder', confirmation_message_id=message_id)
        packet_id = uid()
        packet = {'id': packet_id, 'version': action['version'], 'fields': fields,
                  'hash': preview_hash, 'template_id': action['template_id'], 'created_at': now()}
        state['packets'].append(packet)
        state['current_packet_id'] = packet_id
        state['analysis_required'] = False
        state['flags'] = []
        state['status'] = 'Draft ready'
        state['ui_state'] = 'Idle'
        state['activity'] = f"Packet v{packet['version']} saved from your confirmed preview."
        action.update(status='applied', packet_id=packet_id)
        return {'packet_id': packet_id, 'version': packet['version'], 'hash': preview_hash}, [(packet_id, 'packet', pdf)]
    return repo.mutate(owner, case_id, operation, key, request, revision, change)
