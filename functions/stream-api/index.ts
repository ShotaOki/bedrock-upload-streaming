import { streamFunction } from "./function";

//@ts-ignore
export const handler = awslambda.streamifyResponse(streamFunction);
