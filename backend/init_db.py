"""
Run once to create DynamoDB table (local or AWS).
Usage: python init_db.py
"""
import os
import boto3

TABLE_NAME = os.getenv("DYNAMODB_TABLE", "uni-padel")
ENDPOINT = os.getenv("DYNAMODB_ENDPOINT", "http://localhost:8001")

dynamodb = boto3.client(
    "dynamodb",
    endpoint_url=ENDPOINT,
    region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "local"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "local"),
)

dynamodb.create_table(
    TableName=TABLE_NAME,
    KeySchema=[
        {"AttributeName": "PK", "KeyType": "HASH"},
        {"AttributeName": "SK", "KeyType": "RANGE"},
    ],
    AttributeDefinitions=[
        {"AttributeName": "PK", "AttributeType": "S"},
        {"AttributeName": "SK", "AttributeType": "S"},
        {"AttributeName": "GSI1PK", "AttributeType": "S"},
        {"AttributeName": "GSI1SK", "AttributeType": "S"},
    ],
    GlobalSecondaryIndexes=[
        {
            "IndexName": "GSI1",
            "KeySchema": [
                {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
            ],
            "Projection": {"ProjectionType": "ALL"},
        }
    ],
    BillingMode="PAY_PER_REQUEST",
)

print(f"Table '{TABLE_NAME}' created successfully.")
