"""Compatibility entry point for isolated tests; use app.main for Relay."""
from app.workflow_application import create_workflow_app

app = create_workflow_app()
