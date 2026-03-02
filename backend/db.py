import os
import boto3
from functools import lru_cache

TABLE_NAME = os.getenv("DYNAMODB_TABLE", "uni-padel")
ENDPOINT = os.getenv("DYNAMODB_ENDPOINT", None)


@lru_cache(maxsize=1)
def get_table():
    kwargs = dict(region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
    if ENDPOINT:
        kwargs["endpoint_url"] = ENDPOINT
    dynamodb = boto3.resource("dynamodb", **kwargs)
    return dynamodb.Table(TABLE_NAME)
