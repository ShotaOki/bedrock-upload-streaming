# Bedrock リクエストの遅延送信

Bedrock の互換 API を作成、互換 API に対してリクエストを遅延送信するプロジェクトです。

## セットアップ

Node 18.x のある環境で、利用するライブラリをインストールします。

```bash
npm install
```

CDK でデプロイします。  
us-east-1 リージョンにデプロイされます。

```bash
cdk deploy
```

## python クライアントのセットアップ

python-client ディレクトリに.env ファイルを作成します。

```text
ENDPOINT_URL="https://xxxxxxxxxxxxxxxxx"
```

ENDPOINT_URL には、cdk でデプロイした関数 URL を設定します。

python-client ディレクトリで、requirements.txt をインストールします。

```
pip install -r requirements.txt
```

## python クライアントの実行

互換 API を使ってリクエストします。

```bash
python app-claude.py
```

通常のリクエストを実行します。

```bash
python app-claude-original.py
```

互換 API を利用すると、Bedrock を実行しながら、S3 にファイルをアップロードします。  
S3 がファイルを受け取ると、トリガーが実行され、AWS IoT でメッセージが送信されます。  
IoT のメッセージを互換 API が受け取ると、S3 のファイルからプロンプトを読み込んで、Bedrock の続きを実行します。
