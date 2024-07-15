import {
  IoTDataPlaneClient,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { randomUUID } from "crypto";

export const handler = async (event: any, context: any) => {
  console.log("Create Item");
  console.log(event);

  const client = new IoTDataPlaneClient();

  for (const item of event.Records) {
    const bucketName = item.s3.bucket.name;
    const objectKey = item.s3.object.key;
    const input = {
      topic: (process.env.TOPIC_NAME ?? "").replace("${id}", randomUUID()),
      qos: 1,
      retain: false,
      payload: new TextEncoder().encode(
        JSON.stringify({
          bucketName,
          objectKey,
        })
      ),
    };
    const command = new PublishCommand(input);
    await client.send(command);
  }
};
