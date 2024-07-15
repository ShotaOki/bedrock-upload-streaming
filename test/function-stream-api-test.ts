import { streamFunction } from "../functions/stream-api/function";

streamFunction(
  {},
  {
    //@ts-ignore
    write(content: string) {
      console.log(content);
    },
    //@ts-ignore
    end() {},
  },
  {}
).then(() => {});
