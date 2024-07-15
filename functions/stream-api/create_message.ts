import { Buffer } from "node:buffer";
import { Crc32 } from "@aws-crypto/crc32";

// バイト長を定義する
const BytesLength = {
  // 非負整数のバイト長
  Uint8: 1,
  Uint16: 2,
  Uint32: 4,
  // データの大きさを表すプレリュードの書き込み領域
  Prelude: 12,
  // プレリュード自身のCRCを除いたプレリュードの書き込み領域
  PreludeWithoutCRC: 8,
  // メッセージ全体のCRCの書き込み領域
  MessageCRC: 4,
  // ヘッダの書き込み領域
  HeaderWriteSpace: 512,
};

// ヘッダのセパレータ: \x07\x00
const HEADER_SEPARATOR = 0x0700;

/** バッファ操作のラッパー */
class BufferControl {
  private _buffer: ArrayBuffer;
  private _writer: DataView;
  private _textEncoder: TextEncoder;
  private _offset: number;

  /** コンストラクタ */
  constructor(bufferLength: number) {
    this._buffer = new ArrayBuffer(bufferLength);
    this._writer = new DataView(this._buffer);
    this._textEncoder = new TextEncoder();
    this._offset = 0;
  }

  /** 8ビットの非負整数を書き込む */
  writeUint8(value: number) {
    const writeOffset = this._offset;
    this._writer.setUint8(writeOffset, value);
    this._offset = writeOffset + BytesLength.Uint8;
  }

  /** 16ビットの非負整数を書き込む */
  writeUint16(value: number) {
    const writeOffset = this._offset;
    this._writer.setUint16(writeOffset, value);
    this._offset = writeOffset + BytesLength.Uint16;
  }

  /** 32ビットの非負整数を書き込む */
  writeUint32(value: number) {
    const writeOffset = this._offset;
    this._writer.setUint32(writeOffset, value);
    this._offset = writeOffset + BytesLength.Uint32;
  }

  /** テキストを書き込む */
  writeText(text: string) {
    const writeOffset = this._offset;
    const textBuffer = this._textEncoder.encode(text);
    for (let i = 0; i < textBuffer.length; i++) {
      this._writer.setUint8(i + writeOffset, textBuffer[i]);
    }
    this._offset = writeOffset + textBuffer.length;
  }

  /** バッファを書き込む */
  writeBuffer(buffer: ArrayBuffer) {
    const writeOffset = this._offset;
    const reader = new DataView(buffer);
    for (let i = 0; i < buffer.byteLength; i++) {
      this._writer.setUint8(i + writeOffset, reader.getUint8(i));
    }
    this._offset = writeOffset + buffer.byteLength;
  }

  /** 先頭から書き込みの終わった場所までのバッファを返す */
  get buffer() {
    return this._buffer.slice(0, this._offset);
  }

  /** 指定した地点から指定した地点までのバッファを返す、終点が未指定なら書き込みが終わった場所までを返す */
  slice(from: number, to?: number) {
    if (to === undefined) {
      return this._buffer.slice(from, this._offset);
    } else {
      return this._buffer.slice(from, to);
    }
  }

  /** 書き込みの終わったバイト数を返す */
  get byteLength() {
    return this._offset;
  }
}

/** ArrayBufferをBuffer型に変換する */
function arrayBufferToBuffer(buffer: ArrayBuffer) {
  return Buffer.from(buffer);
}

/*
  botoのStreamで読み取ることのできるチャンク形式にデータを整形する
  */
export function createMessage(
  headers: Record<string, string>,
  binary: string | Uint8Array
) {
  const awsCrc32 = new Crc32();
  const headerBuffer = new BufferControl(BytesLength.HeaderWriteSpace);

  /** ヘッダを書き込む */
  for (const [key, value] of Object.entries(headers)) {
    // キーバリュー形式で、キーと値の先頭にバイト数を書き込んだもの
    // セパレータは\x07\x00を書き込む
    // 形式: ${キー長}${キー}\x07\0x00${値長}${値}
    const keyLength = Buffer.byteLength(key);
    const valueLength = Buffer.byteLength(value);
    // キー長とキーを書き込む
    headerBuffer.writeUint8(keyLength);
    headerBuffer.writeText(key);
    // セパレータを書き込む
    headerBuffer.writeUint16(HEADER_SEPARATOR);
    // 値長と値を書き込む
    headerBuffer.writeUint8(valueLength);
    headerBuffer.writeText(value);
  }

  /** ペイロードをBase64で書き込む */
  const payloadData = JSON.stringify({
    bytes: Buffer.from(binary).toString("base64"),
  });
  const payloadBuffer = new BufferControl(Buffer.byteLength(payloadData));
  payloadBuffer.writeText(payloadData);

  /** プレリュードを定義する */
  const preludeBuffer = new BufferControl(BytesLength.Prelude);
  // プレリュードには、データ全体の長さ、ヘッダの長さ、プレリュードのCRC32をそれぞれ32ビットで書き込む
  const totalLength =
    headerBuffer.byteLength +
    payloadBuffer.byteLength +
    BytesLength.Prelude +
    BytesLength.MessageCRC;
  const headerLength = headerBuffer.byteLength;
  // データ全体の長さを記入する
  preludeBuffer.writeUint32(totalLength);
  // ヘッダの長さを記入する
  preludeBuffer.writeUint32(headerLength);
  // プレリュードのCRC32を作成する
  awsCrc32.update(arrayBufferToBuffer(preludeBuffer.buffer));
  // プレリュードのCRC32を記入する
  preludeBuffer.writeUint32(awsCrc32.digest());

  /** 返却するデータを作成する */
  const messageBuffer = new BufferControl(totalLength);
  // データの先頭にはプレリュードを書き込む
  messageBuffer.writeBuffer(preludeBuffer.buffer);
  // プレリュードの次に、ヘッダを書き込む
  messageBuffer.writeBuffer(headerBuffer.buffer);
  // ヘッダの次に、ペイロードを書き込む
  messageBuffer.writeBuffer(payloadBuffer.buffer);
  // 返却するデータのCRC32を計算する
  // ※プレリュードのCRCの続きで計算する
  // ※プレリュードのCRCに使った、データ全体の長さ、ヘッダの長さは除いたバッファを利用する
  awsCrc32.update(
    arrayBufferToBuffer(messageBuffer.slice(BytesLength.PreludeWithoutCRC))
  );
  // データ全体のCRC32をメッセージの末尾に書き込む
  messageBuffer.writeUint32(awsCrc32.digest());

  // データはBuffer型で返す
  return arrayBufferToBuffer(messageBuffer.buffer);
}
