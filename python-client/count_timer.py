from time import perf_counter_ns
from decimal import Decimal


def count_timer(note: str, timers: dict):
    if not (note in timers):
        # 時間を計測する
        timers[note] = perf_counter_ns()


def print_process_time_from_key(from_key: str, to_key: str, message: str, timers: dict):
    if from_key in timers and to_key in timers:
        from_time = timers[from_key]
        to_time = timers[to_key]
        decimal = Decimal.from_float(to_time - from_time) / 1000_000_000
        decimal_text = "{:.2f}".format(decimal)
        print(f"{message}: {decimal_text} sec")


def print_process_time(timers: dict):
    print("\n\n")
    print_process_time_from_key(Note.START_MAIN, Note.END_MAIN, "Total", timers)
    print_process_time_from_key(
        Note.START_MAIN, Note.START_LAMBDA_EXECUTE, "    セッションの初期化時間", timers
    )
    print_process_time_from_key(
        Note.START_LAMBDA_EXECUTE,
        Note.START_RECEIVE_DATA,
        "    Bedrock実行から受信開始まで",
        timers,
    )
    print_process_time_from_key(
        Note.START_LAMBDA_EXECUTE,
        Note.END_RECEIVE_DATA,
        "    Bedrock実行から受信終了まで",
        timers,
    )
    print_process_time_from_key(
        Note.START_LAMBDA_EXECUTE,
        Note.END_LAMBDA_EXECUTE,
        "    Bedrockアップロード時間",
        timers,
    )
    print_process_time_from_key(
        Note.START_UPLOAD,
        Note.END_UPLOAD,
        "    S3アップロード時間",
        timers,
    )
    print_process_time_from_key(
        Note.START_UPLOAD,
        Note.START_RECEIVE_DATA,
        "    S3アップロード開始から受信開始まで",
        timers,
    )
    print_process_time_from_key(
        Note.START_UPLOAD,
        Note.END_RECEIVE_DATA,
        "    S3アップロード開始から受信終了まで",
        timers,
    )


class Note:
    START_MAIN = "START_MAIN"
    END_MAIN = "END_MAIN"
    START_LAMBDA_EXECUTE = "START_LAMBDA_EXECUTE"
    END_LAMBDA_EXECUTE = "END_LAMBDA_EXECUTE"
    START_UPLOAD = "START_UPLOAD"
    END_UPLOAD = "END_UPLOAD"
    START_RECEIVE_DATA = "START_RECEIVE_DATA"
    END_RECEIVE_DATA = "END_RECEIVE_DATA"
