"""Build AWS sessions from Relay's configured profile or environment credentials."""

from __future__ import annotations

import os

import boto3
import botocore.session


def create_aws_session(region: str, profile: str | None = None) -> boto3.Session:
    """Prefer an existing named profile, then explicit credentials, then the SDK chain.

    A profile configured on another host must not hide credentials supplied to
    this process. Passing those credentials directly also avoids boto3 picking
    up an unavailable AWS_PROFILE while it constructs its provider chain.
    """
    selected_profile = profile or os.environ.get("AWS_PROFILE") or None
    if selected_profile and selected_profile in botocore.session.get_session().available_profiles:
        return boto3.Session(profile_name=selected_profile, region_name=region)

    access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    if access_key and secret_key:
        sdk_session = botocore.session.get_session()
        # Botocore still reads AWS_PROFILE while constructing a client even
        # when static credentials were passed to boto3.Session. Override that
        # config value on this session alone; leave process environment intact.
        sdk_session.get_component("config_store").set_config_variable("profile", None)
        return boto3.Session(
            botocore_session=sdk_session,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            aws_session_token=os.environ.get("AWS_SESSION_TOKEN") or None,
            region_name=region,
        )

    if selected_profile:
        # Preserve the SDK's useful ProfileNotFound error when no alternative
        # credentials are configured.
        return boto3.Session(profile_name=selected_profile, region_name=region)
    return boto3.Session(region_name=region)
