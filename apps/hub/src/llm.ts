// Modèle gpt-6-luna (gpt-6.1-sol avant le 25/11/2026) déployé dans Microsoft Foundry, appelé par l'API Responses avec l'identité
// managée de l'app (Microsoft Entra ID, jeton de portée https://ai.azure.com/.default) : aucune clé.
// Source : learn.microsoft.com/azure/foundry/foundry-models/how-to/configure-entra-id
import type { TokenCredential } from "@azure/identity";

/** Jetons facturés d'un appel (les jetons de raisonnement comptent dans la sortie). */
export interface Usage { inputTokens: number; outputTokens: number }

export interface Llm {
  text(instructions: string, input: string, maxTokens?: number): Promise<string>;
  /**
   * Lit des images JPEG et répond selon un schéma JSON strict. Renvoie aussi les jetons facturés,
   * pour suivre le coût réel. Learn : learn.microsoft.com/azure/foundry/openai/how-to/responses#image-input
   */
  look(instructions: string, images: { label: string; jpeg: Uint8Array }[], format: { name: string; schema: Record<string, unknown> }, maxTokens?: number): Promise<{ json: unknown; usage: Usage }>;
  triageNews(items: { id: string; title: string; source: string }[]): Promise<{ id: string; local: boolean; topic: string; summary: string }[]>;
}

/** Texte de sortie d'une réponse de l'API Responses (champ de commodité ou parcours des sorties). */
export function outputText(j: { output_text?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] }): string {
  if (typeof j.output_text === "string" && j.output_text) return j.output_text;
  return (j.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text" && c.text)
    .map((c) => c.text)
    .join("");
}

export function foundryLlm(endpoint: string, deployment: string, credential: TokenCredential): Llm {
  const base = endpoint.replace(/\/+$/, "");
  async function raw(body: Record<string, unknown>): Promise<{ text: string; usage: Usage }> {
    const token = await credential.getToken("https://ai.azure.com/.default");
    if (!token) throw new Error("no token for Foundry");
    const res = await fetch(`${base}/openai/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.token}` },
      body: JSON.stringify({ model: deployment, reasoning: { effort: "low" }, ...body }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Foundry ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json() as Parameters<typeof outputText>[0] & { usage?: { input_tokens?: number; output_tokens?: number } };
    return { text: outputText(j), usage: { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 } };
  }
  const call = async (body: Record<string, unknown>) => (await raw(body)).text;
  return {
    async look(instructions, images, format, maxTokens = 1000) {
      const content = images.flatMap((im) => [
        { type: "input_text", text: im.label },
        { type: "input_image", image_url: `data:image/jpeg;base64,${Buffer.from(im.jpeg).toString("base64")}`, detail: "high" },
      ]);
      const { text, usage } = await raw({
        instructions, input: [{ role: "user", content }], max_output_tokens: maxTokens,
        text: { format: { type: "json_schema", name: format.name, strict: true, schema: format.schema } },
      });
      // Une réponse vide ou coupée est une erreur, mais ses jetons sont facturés : on les rend avec l'erreur.
      try { return { json: JSON.parse(text), usage }; } catch { throw Object.assign(new Error("model answer is not JSON"), { usage }); }
    },
    text: (instructions, input, maxTokens = 400) => call({ instructions, input, max_output_tokens: maxTokens }),
    async triageNews(items) {
      const out = await call({
        instructions:
          "You sort news headlines for a family living in Maroubra, in the City of Randwick, Sydney. " +
          "For each item decide if it is local news about Randwick City (Maroubra, Randwick, Coogee, Kingsford, Kensington, Malabar, Matraville, Little Bay, La Perouse, Chifley, Clovelly) " +
          "or the beaches and coast nearby. Sport scores from elsewhere, real-estate ads and national stories that only mention a suburb in passing are not local. " +
          "Give a topic among: beach, environment, council, transport, community, safety, events, business, other. " +
          "Write a neutral one-sentence summary in plain English from the headline only; never invent facts. Answer with JSON only.",
        input: JSON.stringify(items),
        max_output_tokens: 3000,
        text: {
          format: {
            type: "json_schema", name: "triage", strict: true,
            schema: {
              type: "object", additionalProperties: false, required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object", additionalProperties: false, required: ["id", "local", "topic", "summary"],
                    properties: { id: { type: "string" }, local: { type: "boolean" }, topic: { type: "string" }, summary: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      });
      return (JSON.parse(out) as { items: { id: string; local: boolean; topic: string; summary: string }[] }).items;
    },
  };
}
