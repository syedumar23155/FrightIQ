declare module "ws" {
  type MessageData = { toString(encoding?: string): string };
  class WebSocket {
    static OPEN: number;
    constructor(address: string, options?: Record<string, unknown>);
    readyState: number;
    on(event: "open", callback: () => void): this;
    on(event: "pong", callback: () => void): this;
    on(event: "message", callback: (data: MessageData) => void): this;
    on(event: "error", callback: (error: Error) => void): this;
    on(event: "close", callback: (code: number) => void): this;
    send(data: string): void;
    ping(): void;
    terminate(): void;
    close(code?: number, reason?: string): void;
  }
  export default WebSocket;
}
