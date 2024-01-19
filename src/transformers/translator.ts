import { Polychat } from "..";

export class GenericTransformer {
    async transformEventForNetwork(polychat: Polychat, event: any): Promise<{ content: Record<string, any> }> {
        const res = await fetch("http://localhost:5000/translate", {
            method: 'POST',
            body: JSON.stringify({
                q: event.content.body,
                source: 'en',
                target: 'eo',
                format: 'text',
                api_key: '',
            }),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json() as any;
        return {
            content: {
                ...event.content,
                body: `Polychat user: ${data.translatedText}`,
            },
        };
    }
}