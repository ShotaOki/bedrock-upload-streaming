from typing import Dict
from botocore.awsrequest import AWSPreparedRequest, AWSRequest
from botocore.auth import SigV4Auth
from botocore.httpsession import URLLib3Session
import boto3
from boto3.session import Session
import re

_request: AWSRequest = None
HTTPS_DYNAMIC_ENDPOINT_PLACEHOLDER = "https://URL-PLACEHOLDER"


class EndpointUrlHandler:
    _url_map: Dict[str, str]
    _defaults_url: str

    def __init__(self, url_map: Dict[str, str], defaults_url: str) -> None:
        self._url_map = url_map
        self._defaults_url = defaults_url

    def __getitem__(self, index):
        if (self._url_map is not None) and (index in self._url_map):
            return self._url_map[index]
        return self._defaults_url

    @property
    def has_map(self):
        if self._defaults_url is None:
            return False
        return True


def patch_credentials_scope(
    runtime,
    session,
    service_name: str,
    url_map: Dict[str, str] = None,
    defaults_url: str = None,
):
    """
    boto3がリクエストする認証スコープを書き変える
    """
    # イベントのハンドラを取得する
    event_system = runtime.meta.events
    endpoints = EndpointUrlHandler(url_map, defaults_url)

    # 署名の直前に呼ばれる関数を定義する
    def _ref_request(request: AWSRequest, **kwargs):
        operation_name = kwargs["operation_name"]
        # 署名前の送信情報を参照する
        global _request
        if endpoints.has_map:
            request.url = re.sub(
                HTTPS_DYNAMIC_ENDPOINT_PLACEHOLDER,
                endpoints[operation_name],
                request.url,
            )
        _request = request

    # API送信の直前に呼ばれる関数を定義する
    def _before_send(request: AWSPreparedRequest, **kwargs):
        # ここで受け取るrequestはprepareでURLエンコードされているので、
        # 署名前の送信情報を元に再署名をする

        # ヘッダの型をstr: strに整形する
        def header_item_from_prepare_request(item):
            if isinstance(item, bytes):
                return item.decode()
            return item

        # 署名に使う情報をあらためて詰め直す
        requester = AWSRequest(
            url=_request.url,
            method=_request.method,
            headers={
                k: header_item_from_prepare_request(h)
                for k, h in _request.headers.items()
            },
            data=_request.body.decode(),
            stream_output=request.stream_output,
        )
        # SigV4で署名する
        # service_nameがクレデンシャルスコープになるので、ここを書き変える
        SigV4Auth(
            session.get_credentials(), service_name, session.region_name
        ).add_auth(requester)

        # 送信処理を実行。この関数の実行結果がboto3の実行結果になる
        return URLLib3Session().send(requester.prepare())

    # boto3の割り込みのハンドラを登録する
    # ハンドラの一覧: https://boto3.amazonaws.com/v1/documentation/api/latest/guide/events.html
    event_system.register("before-send.*", _before_send)
    event_system.register_first("before-sign.*", _ref_request)


def patch_to_session(
    session: Session = None,
    service_name: str = None,
    dynamic_url_map: Dict[str, str] = None,
    defaults_endpoint_url: str = None,
):
    """
    セッションに対して、パッチを登録する

    Examples:
        # 確保したセッションにパッチを登録する
        session = boto3.Session(region_name="us-east-1")
        patch_to_session(
            session,
            service_name="lambda",
            dynamic_url_map={
                "InvokeModelWithResponseStream": "https://localhost:8000",
                "InvokeModel": "https://localhost:8002",
            },
            defaults_endpoint_url="https://localhost:8080",
        )
    Examples:
        # デフォルトセッションにパッチを登録する
        patch_to_session(
            service_name="lambda",
            dynamic_url_map={
                "InvokeModelWithResponseStream": "https://localhost:8000",
                "InvokeModel": "https://localhost:8002",
            },
            defaults_endpoint_url="https://localhost:8080",
        )
    """
    apply_session: Session = session
    if session is None:
        apply_session = boto3._get_default_session()

    _session_client = apply_session.client

    def _session_client_wrapper(*args, **kargs):
        kargs["endpoint_url"] = HTTPS_DYNAMIC_ENDPOINT_PLACEHOLDER
        client = _session_client(*args, **kargs)

        patch_credentials_scope(
            client,
            apply_session,
            service_name,
            url_map=dynamic_url_map,
            defaults_url=defaults_endpoint_url,
        )
        return client

    apply_session.client = _session_client_wrapper
