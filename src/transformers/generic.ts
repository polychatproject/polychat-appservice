import { Polychat } from "..";

export class GenericTransformer {
    async transformEventForNetwork(polychat: Polychat, event: any): Promise<{ content: Record<string, any> }> {
        return {
            content: {
                ...event.content,
                body: `Polychat user: ${event.content.body}`,
            }
        };
    }
}