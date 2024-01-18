import { Channel } from "..";

export class GenericTransformer {
    async transformEventForNetwork(channel: Channel, event: any): Promise<{ content: Record<string, any> }> {
        return {
            content: {
                ...event.content,
                body: `Polychat user: ${event.content.body}`,
            }
        };
    }
}