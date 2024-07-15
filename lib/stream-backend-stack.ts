import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Runtime } from "aws-cdk-lib/aws-lambda";

interface StackInput extends cdk.StackProps {
  iotEndpoint: string;
}

export class StreamBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackInput) {
    super(scope, id, props);

    const stack = cdk.Stack.of(this);
    const bucketName = `${stack.stackName.toLowerCase()}-delay-upload-resource-bucket`;

    /** Lambdaの実行ロールを設定する */
    const role = new cdk.aws_iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "bedrock:*",
          "iot:*",
        ],
        effect: cdk.aws_iam.Effect.ALLOW,
        resources: ["*"],
      })
    );

    /** Lambdaを作成する */
    const lambdaFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "BedrockStreamingAPI",
      {
        entry: "functions/stream-api/index.ts",
        runtime: Runtime.NODEJS_18_X,
        timeout: cdk.Duration.seconds(60),
        depsLockFilePath: "package-lock.json",
        bundling: {
          forceDockerBundling: false,
          nodeModules: [
            "@aws-crypto/crc32",
            "@aws-sdk/client-bedrock-runtime",
            "@aws-sdk/client-s3",
            "aws-iot-device-sdk-v2",
          ],
        },
        environment: {
          IOT_ENDPOINT: props.iotEndpoint,
          TOPIC_NAME: "topic/put-record-notice/#",
          BUCKET_NAME: bucketName,
        },
        role,
      }
    );

    /** 関数URLを公開する */
    lambdaFunction.addFunctionUrl({
      authType: cdk.aws_lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: cdk.aws_lambda.InvokeMode.RESPONSE_STREAM,
    });

    /** 送信 */
    const publishEventFunction = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      "PublishEventFunction",
      {
        entry: "functions/publish-iot/index.ts",
        runtime: Runtime.NODEJS_18_X,
        timeout: cdk.Duration.seconds(15),
        depsLockFilePath: "package-lock.json",
        bundling: {
          forceDockerBundling: false,
          nodeModules: ["@aws-sdk/client-iot-data-plane"],
        },
        environment: {
          IOT_ENDPOINT: props.iotEndpoint,
          TOPIC_NAME: "topic/put-record-notice/${id}",
        },
        role,
      }
    );

    const bucket = new cdk.aws_s3.Bucket(this, "Bucket", {
      bucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    bucket.grantRead(lambdaFunction);

    bucket.addEventNotification(
      cdk.aws_s3.EventType.OBJECT_CREATED,
      new cdk.aws_s3_notifications.LambdaDestination(publishEventFunction)
    );
  }
}
