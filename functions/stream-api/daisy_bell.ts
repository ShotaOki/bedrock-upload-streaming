import { Writable } from "stream";
import { createMessage } from "./create_message";

export async function singDaisyBell(responseStream: Writable) {
  const daisyBell =
    "Daisy, Daisy, give me your answer do I'm half crazy all for the love of you";
  daisyBell.split(" ").forEach((word, index) => {
    responseStream.write(
      createMessage(
        {
          ":event-type": "chunk",
          ":content-type": "application/json",
          ":message-type": "event",
        },
        JSON.stringify({
          type: "content_block_delta",
          index: index,
          delta: {
            type: "text_delta",
            text: word + " ",
          },
        })
      )
    );
  });
}
