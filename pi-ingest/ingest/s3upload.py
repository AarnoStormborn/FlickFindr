"""S3 upload — streaming, single-threaded parts for minimal memory."""

from __future__ import annotations

import os

import boto3
from boto3.s3.transfer import TransferConfig

# Single-threaded, modest part size: keeps the in-flight buffer small on Pi.
_TRANSFER = TransferConfig(
    multipart_threshold=16 * 1024 * 1024,
    multipart_chunksize=8 * 1024 * 1024,
    max_concurrency=1,
    use_threads=False,
)


def upload_parquet(s3_client, bucket: str, key: str, local_path: str) -> int:
    """Stream a local parquet file to S3; returns byte count."""
    size = os.path.getsize(local_path)
    with open(local_path, "rb") as fh:
        s3_client.upload_fileobj(fh, bucket, key, Config=_TRANSFER)
    return size


def make_s3_client(region: str):
    kwargs: dict[str, str] = {}
    if region:
        kwargs["region_name"] = region
    # Credentials come from env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) or
    # the well-known shared-credentials file — boto3 handles both by default.
    return boto3.client("s3", **kwargs)