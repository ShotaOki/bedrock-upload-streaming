#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { StreamBackendStack } from "../lib/stream-backend-stack";
import { fromIni } from "@aws-sdk/credential-providers";
import { DescribeEndpointCommand, IoTClient } from "@aws-sdk/client-iot";

// Profileを指定する
const sdkCredentials = fromIni({
  profile: "default",
});
const iotClient = new IoTClient({
  credentials: sdkCredentials,
  region: "us-east-1",
});

// 非同期で作成する
iotClient
  .send(
    // IoTエンドポイント（データ受信用）を取得する
    new DescribeEndpointCommand({
      endpointType: "iot:Data-ATS",
    })
  )
  .then((response) => {
    const app = new cdk.App();
    new StreamBackendStack(app, "UploadStreamingStack", {
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
      iotEndpoint: response.endpointAddress ?? "",
    });
  });
