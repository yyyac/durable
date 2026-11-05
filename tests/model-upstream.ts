import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';

export class ProtocolUpstream {
  readonly requests: Array<{ path: string; authorization?: string; apiKey?: string; body: Record<string, unknown> }> = [];
  readonly server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as Record<string, unknown>;
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    this.requests.push({ path, authorization: req.headers.authorization, apiKey: req.headers['x-api-key'] as string | undefined, body: request });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const model = String(request.model);
    const text = `已连接 ${model}`;
    if (path.endsWith('/chat/completions')) {
      const chunk = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'chat-protocol', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: 'assistant', content: text });
      await new Promise((resolve) => setTimeout(resolve, 150));
      chunk({}, 'stop'); res.end('data: [DONE]\n\n');
    } else if (path.endsWith('/responses')) {
      const item = { id: 'msg-protocol', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
      this.event(res, 'response.created', { response: { id: 'resp-protocol', status: 'in_progress' } });
      this.event(res, 'response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      this.event(res, 'response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: text });
      await new Promise((resolve) => setTimeout(resolve, 150));
      this.event(res, 'response.output_item.done', { output_index: 0, item });
      this.event(res, 'response.completed', { response: { id: 'resp-protocol', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } });
      res.end();
    } else if (path.endsWith('/messages')) {
      this.event(res, 'message_start', { message: { id: 'msg-protocol', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
      this.event(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      this.event(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
      await new Promise((resolve) => setTimeout(resolve, 150));
      this.event(res, 'content_block_stop', { index: 0 });
      this.event(res, 'message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
      this.event(res, 'message_stop', {}); res.end();
    } else { res.end(); }
  });
  private event(res: ServerResponse, type: string, body: object) { res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`); }
  async start() { this.server.listen(0, '127.0.0.1'); await once(this.server, 'listening'); }
  get url() { return `http://127.0.0.1:${(this.server.address() as { port: number }).port}`; }
  close() { this.server.closeAllConnections(); this.server.close(); }
}
