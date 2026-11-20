import { writeFileSync } from 'node:fs';

export default {
  id: 'ia-lab-limites',
  async setup(ctx) {
    const mensaje = process.env.IA_LAB_MODO === 'Mensaje';
    const maximo = mensaje ? 1 : 12;
    const consumo = { solicitudes: 0, pasosConUso: 0, entrada: 0, salida: 0 };
    const guardarConsumo = () => {
      writeFileSync(process.env.IA_LAB_CONSUMO, JSON.stringify(consumo));
    };
    let detenido = false;
    if (mensaje) {
      await ctx.session.hook('context', event => {
        event.system = [{ type: 'text', text: 'Responde directamente al mensaje. Usa el idioma de la persona.' }];
        event.tools = {};
      });
      await ctx.session.hook('prompt', event => {
        event.prompt.files = [];
        event.prompt.skills = [];
      });
    }
    await ctx.shell.hook('create.before', event => {
      for (const name of Object.keys(event.env)) {
        if (['NVIDIA_API_KEY', 'OPENCODE_PASSWORD', 'OPENCODE_SERVER_PASSWORD'].includes(name.toUpperCase())) {
          delete event.env[name];
        }
      }
    });
    await ctx.session.hook('http.request', event => {
      if (detenido || consumo.solicitudes >= maximo || event.kind !== 'primary' ||
          event.request.method !== 'POST' || event.request.url !== process.env.IA_LAB_DESTINO ||
          event.request.headers.get('authorization') !== 'Bearer ' + process.env.NVIDIA_API_KEY) {
        throw new Error('Se alcanzó el límite de la sesión o la solicitud quedó fuera del perfil.');
      }
      consumo.solicitudes++;
      guardarConsumo();
    });
    await ctx.session.hook('http.response', event => {
      if (!event.response.ok) detenido = true;
      writeFileSync(process.env.IA_LAB_ESTADO_HTTP, String(event.response.status));
    });
    await ctx.session.hook('retry', event => {
      detenido = true;
      event.decision = { retry: false };
    });
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ['session.step.ended'],
          signal: controller.signal,
        })) {
          const { input, output } = event.data.tokens ?? {};
          if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0 ||
              input + output === 0) continue;
          consumo.pasosConUso++;
          consumo.entrada += input;
          consumo.salida += output;
          guardarConsumo();
        }
      } catch {
        // The session can finish while usage events are still being delivered.
      }
    })();
    return () => controller.abort();
  },
};
