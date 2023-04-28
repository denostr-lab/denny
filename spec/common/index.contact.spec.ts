import { PRIVATE_KEY, PRIVATE_KEY2, PRIVATE_KEY3 } from "../data";
import { getPublicKey } from "nostr-tools";

import {
    login,
    enterPublicRoom,
    createBrowserAndPage,
    findRoomFromRoomList,
    createGroupChat,
    sendMessage,
    searchRoomMember,
    hasFollow,
    clickFollow,
    toContactPage,
    closeModal,
    serachContact,
    logout,
    serachContactNoResult,
} from "../utils";

import { PageAndBrowser } from "../@types/index";

describe("teset relays", () => {
    let pageRes: PageAndBrowser[];
    beforeAll(async () => {
        pageRes = await Promise.all([createBrowserAndPage(), createBrowserAndPage(), createBrowserAndPage()]);
        await Promise.all([
            login(pageRes[0].page, PRIVATE_KEY),
            login(pageRes[1].page, PRIVATE_KEY2),
            login(pageRes[2].page, PRIVATE_KEY3),
        ]);
        const roomName = await findRoomFromRoomList(pageRes[0].page);
        if (!roomName) {
            const roomName = "public room global";
            await createGroupChat(pageRes[0].page, roomName);
            await pageRes[0].page.waitForTimeout(3 * 1000);
        }
        await Promise.all([
            enterPublicRoom(pageRes[0].page),
            enterPublicRoom(pageRes[1].page),
            enterPublicRoom(pageRes[2].page),
        ]);
    }, 360 * 1000);
    afterAll(async () => {
        pageRes.forEach(async (p) => {
            try {
                await p.browser.close();
            } catch (e) {}
        });
    });
    it(
        "send Message ",
        async () => {
            const text1 = `hellow-${new Date().toISOString()}-${Math.random()}`;
            const text2 = `hellow-${new Date().toISOString()}-${Math.random()}`;
            const text3 = `hellow-${new Date().toISOString()}-${Math.random()}`;
            await Promise.all([
                sendMessage(pageRes[0].page, text1),
                sendMessage(pageRes[1].page, text2),
                sendMessage(pageRes[2].page, text3),
            ]);
            await pageRes[1].browser.close();
            await pageRes[2].browser.close();
            await pageRes[0].page.waitForTimeout(2 * 1000);
        },
        90 * 1000,
    );

    it(
        "find user and follow",
        async () => {
            await Promise.all([searchRoomMember(pageRes[0].page, getPublicKey(PRIVATE_KEY2), false)]);
            let isFollowed = await hasFollow(pageRes[0].page);
            if (!isFollowed) {
                await clickFollow(pageRes[0].page);
            }

            await closeModal(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(1 * 1000);

            await Promise.all([searchRoomMember(pageRes[0].page, getPublicKey(PRIVATE_KEY3), false)]);
            isFollowed = await hasFollow(pageRes[0].page);
            if (!isFollowed) {
                await clickFollow(pageRes[0].page);
            }
            await closeModal(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(1 * 1000);
        },
        90 * 1000,
    );
    it(
        "to contact list to view",
        async () => {
            await toContactPage(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(3 * 1000);

            await serachContact(pageRes[0].page, getPublicKey(PRIVATE_KEY2));
            let isFollowed = await hasFollow(pageRes[0].page);
            expect(isFollowed).toEqual(true);
            await closeModal(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(1 * 1000);

            await serachContact(pageRes[0].page, getPublicKey(PRIVATE_KEY3));
            isFollowed = await hasFollow(pageRes[0].page);
            expect(isFollowed).toEqual(true);
            await closeModal(pageRes[0].page);
        },
        90 * 1000,
    );
    it(
        "user1 logout and re scan",
        async () => {
            await logout(pageRes[0].page, true);
            await pageRes[0].page.waitForTimeout(4 * 1000);
            await login(pageRes[0].page, PRIVATE_KEY);
            await toContactPage(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(3 * 1000);

            await serachContact(pageRes[0].page, getPublicKey(PRIVATE_KEY2));
            let isFollowed = await hasFollow(pageRes[0].page);
            expect(isFollowed).toEqual(true);
            await closeModal(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(1 * 1000);
            await serachContact(pageRes[0].page, getPublicKey(PRIVATE_KEY3));
            isFollowed = await hasFollow(pageRes[0].page);
            expect(isFollowed).toEqual(true);
            await closeModal(pageRes[0].page);
        },
        90 * 1000,
    );
    it(
        "user1 unfollow user2 and reload to sance",
        async () => {
            await serachContact(pageRes[0].page, getPublicKey(PRIVATE_KEY2));
            await clickFollow(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(2 * 1000);

            await logout(pageRes[0].page, true);
            await pageRes[0].page.waitForTimeout(2 * 1000);

            await login(pageRes[0].page, PRIVATE_KEY);
            await toContactPage(pageRes[0].page);
            await pageRes[0].page.waitForTimeout(3 * 1000);

            const res = await serachContactNoResult(pageRes[0].page, getPublicKey(PRIVATE_KEY2));
            expect(res).toEqual("No results found!");
            await serachContact(pageRes[0].page, getPublicKey(PRIVATE_KEY3));
            let isFollowed = await hasFollow(pageRes[0].page);
            expect(isFollowed).toEqual(true);
            await closeModal(pageRes[0].page);
        },
        90 * 1000,
    );
});
