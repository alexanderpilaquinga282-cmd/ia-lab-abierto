import { Buffer } from 'node:buffer';

const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function createImageProvider(request = fetch) {
  let credential;
  return {
    get connected() { return Boolean(credential); },
    connect(account, token) {
      if (typeof account !== 'string' || !/^[a-f0-9]{32}$/i.test(account) ||
          typeof token !== 'string' || !/^[a-zA-Z0-9_-]{20,256}$/.test(token)) {
        return false;
      }
      credential = { account, token };
      return true;
    },
    clear() { credential = undefined; },
    async run(prompt, reference, signal) {
      const { account, token } = credential;
      const form = new FormData();
      form.set('prompt', prompt);
      form.set('width', '512');
      form.set('height', '512');
      if (reference) form.set('input_image_0', reference, 'referencia.png');

      const response = await request('https://api.cloudflare.com/client/v4/accounts/' + account + '/ai/run/' + MODEL, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + token },
        body: form,
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) credential = undefined;
        return { status: response.status };
      }

      let mime;
      let buffer;
      const type = response.headers.get('content-type')?.split(';')[0];
      if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        const data = await response.json();
        if (data.success === false || typeof data.result?.image !== 'string') return { status: 502 };
        buffer = Buffer.from(data.result.image, 'base64');
      }

      if (buffer.subarray(0, 8).equals(PNG)) mime = 'image/png';
      else if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) mime = 'image/jpeg';
      else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
      return mime ? { status: 200, mime, image: buffer.toString('base64') } : { status: 502 };
    },
  };
}

export function imageReference(encoded) {
  if (encoded == null) return undefined;
  if (typeof encoded !== 'string' || encoded.length > 1_400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width >= 512 || height >= 512) return null;
  return new Blob([bytes], { type: 'image/png' });
}
