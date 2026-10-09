/**
 * Where realtime messages go. In the API process: straight to the Socket.IO
 * server (RealtimeGateway). In the worker: through Redis to every API
 * instance (EmitterRealtimePublisher), since the worker holds no sockets.
 */
export abstract class RealtimePublisher {
  abstract publish<T>(room: string, event: string, data: T): Promise<void>;
}
