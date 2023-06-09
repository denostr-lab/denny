import { getPublicKey } from "nostr-tools";
import { PRIVATE_KEY, PRIVATE_KEY2 } from "../data";
import { login, createBrowserAndPage, findPrivateMessageRoomWithPubKey } from "../utils";
import { executeRommOperations } from "../roomchatUtils";
import { User } from "../@types/index";

describe("test two person enter public room and chat", () => {
    let user1: User = {
        page: null,
        browser: null,
        pubkey: getPublicKey(PRIVATE_KEY),
    } as unknown as User;
    let user2: User = {
        page: null,
        browser: null,
        pubkey: getPublicKey(PRIVATE_KEY2),
    } as unknown as User;

    beforeAll(async () => {
        const result1 = await createBrowserAndPage();
        user1 = { ...user1, ...result1 };
        const result2 = (await createBrowserAndPage()) as unknown as User;
        user2 = { ...user2, ...result2 };
        await Promise.all([login(user1.page, PRIVATE_KEY), login(user2.page, PRIVATE_KEY2)]);
        await Promise.all([
            findPrivateMessageRoomWithPubKey(user1.page, user2.pubkey),
            findPrivateMessageRoomWithPubKey(user2.page, user1.pubkey),
        ]);
        await user1.page.waitForTimeout(1 * 1000);
        await user2.page.waitForTimeout(1 * 1000);
    }, 360 * 1000);
    afterAll(async () => {
        await user1.browser.close();
        await user2.browser.close();
    });

    executeRommOperations().map((i) => {
        return it(
            i.it,
            async () => {
                await i.func(user1, user2);
            },
            90 * 1000,
        );
    });
});
