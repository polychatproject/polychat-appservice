import { Polychat } from "..";

export class GenericTransformer {
    async transformEventForNetwork(polychat: Polychat, userProfile: Record<string, any>, event: Record<string, any>): Promise<{ content: Record<string, any> }> {
        return {
            content: {
                ...event.content,
                body: `${userProfile.displayname}: ${event.content.body}`,
            }
        };
    }
}