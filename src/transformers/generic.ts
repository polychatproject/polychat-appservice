import { Channel } from "..";

export class GenericTransformer {
    transformEventForNetwork(channel: Channel, event: any): Promise<{ content: Record<string, any> }> {
        return {
            ...event.content,
            body: `Polychat user: ${event.content.body}`,
        };
    }
}