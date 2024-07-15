from botocore.eventstream import EventStream
import boto3
import json
from patch_credentials_scope import patch_credentials_scope
from uuid import uuid4
import sys
import io
import os
from multiprocessing import Process, freeze_support, Manager
from count_timer import count_timer, Note, print_process_time
from dotenv import load_dotenv

load_dotenv()


def main(uuid_key: str, timers: dict):
    """
    Bedrockを実行する
    """
    # メインの処理を開始する
    count_timer(Note.START_MAIN, timers)
    # セッションを初期化する
    session = boto3.Session(region_name="us-east-1")
    runtime = session.client(
        "bedrock-runtime", endpoint_url=os.environ.get("ENDPOINT_URL")
    )
    patch_credentials_scope(runtime, session, "lambda")

    # Lambdaの実行を開始する
    count_timer(Note.START_LAMBDA_EXECUTE, timers)

    # Bedrockをboto3から実行する
    result = runtime.invoke_model_with_response_stream(
        body=json.dumps(
            {
                "objectKey": uuid_key + ".json",
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 100,
                "system": "You are friendly AI",
                "messages": [
                    {
                        "role": "user",
                        "content": "Dummy Message",
                    }
                ],
            }
        ),
        contentType="application/json",
        accept="*/*",
        modelId="delay-upload::anthropic.claude-3-haiku-20240307-v1:0",
    )
    # Lambdaの実行を完了、受信待機を始める
    count_timer(Note.END_LAMBDA_EXECUTE, timers)

    # 応答結果を受け取る
    body: EventStream = result.get("body")
    for event in body:
        # データを受信する
        chunk = json.loads(event["chunk"]["bytes"])
        if chunk["type"] == "content_block_start":
            # データの受信を開始する
            count_timer(Note.START_RECEIVE_DATA, timers)
        if chunk["type"] == "content_block_delta":
            if chunk["delta"]["type"] == "text_delta":
                print(chunk["delta"]["text"], end="")

    count_timer(Note.END_RECEIVE_DATA, timers)
    return timers


def upload_contents(bucket_name: str, uuid_key: str, timers: dict):
    """
    S3にファイルをアップロードする
    """
    # S3にファイルをアップロードする
    # アップロードが完了すると、Bedrockの応答処理が始まる
    s3_client = boto3.client("s3")
    with io.BytesIO(
        json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 100,
                "system": "You are friendly AI",
                "messages": [
                    {
                        "role": "user",
                        "content": "Hello, Claude.",
                    }
                ],
            }
        ).encode("utf-8")
    ) as fp:
        count_timer(Note.START_UPLOAD, timers)
        # データをS3にアップロードする
        s3_client.upload_fileobj(
            fp,
            bucket_name,
            uuid_key + ".json",
        )
        count_timer(Note.END_UPLOAD, timers)

    return timers


if __name__ == "__main__":
    """
    処理のエントリポイント
    """
    print("START")
    freeze_support()

    manager = Manager()
    return_dict = manager.dict()

    # UUIDキーを発行する
    uuid_key = str(uuid4())

    # プロセスを定義する
    main_process = Process(target=main, args=(uuid_key, return_dict))
    upload_process = Process(
        target=upload_contents, args=(sys.argv[1], uuid_key, return_dict)
    )

    print("EXEC")

    # プロセスを分けて、並列で実行する
    for p in [main_process, upload_process]:
        p.start()

    # 処理の完了を待機する
    main_process.join()

    # メインの処理を終了する
    count_timer(Note.END_MAIN, return_dict)

    print_process_time(return_dict)
