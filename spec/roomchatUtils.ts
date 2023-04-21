import { Page } from "puppeteer";

import {
    sendMessage,
    findTimeLineText,
    sendFile,
    findTimeLineLastMessage,
    sendEmojitoLast,
    replyToLastMessage,
    findMemberName,
    findLastFileSourceName,
} from "./utils";
import { User } from "./@types/index";
const getPage = (user1: User, user2: User) => {
    return {
        page: user1.page,
        page2: user2.page,
    };
};
export const executeRommOperations = () => {
    return [
        {
            it: "send text message",
            async func(user1: User, user2: User) {
                const { page, page2 } = getPage(user1, user2);
                const text1 = `hellow-${new Date().toISOString()}-${Math.random()}`;
                await sendMessage(page, text1);
                const text2 = `hellow-${new Date().toISOString()}-${Math.random()}`;
                await sendMessage(page2, text2);
                const resultText = await findTimeLineText(page, text1);
                expect(text1).toEqual(resultText);
                await page.waitForTimeout(1 * 1000);
                const resultText2 = await findTimeLineText(page2, text1);
                expect(text1).toEqual(resultText2);
            },
        },
        {
            it: "send img message",
            async func(user1: User, user2: User) {
                const { page, page2 } = getPage(user1, user2);
                const file = "spec/test.png";
                await sendFile(page, file);
                await page.waitForTimeout(3 * 1000);
                const resultText = await findLastFileSourceName(page);
                const resultText2 = await findTimeLineLastMessage(page2, resultText, "image");

                expect(resultText2).toEqual(resultText);
            },
        },
        {
            it: "send video message",
            async func(user1: User, user2: User) {
                const { page, page2 } = getPage(user1, user2);

                const file = "spec/test.mp4";
                await sendFile(page, file);
                await page.waitForTimeout(4 * 1000);

                const resultText = await findLastFileSourceName(page);
                const resultText2 = await findTimeLineLastMessage(page2, resultText, "video");

                expect(resultText2).toEqual(resultText);
            },
        },
        {
            it: "send emoji message",
            async func(user1: User, user2: User) {
                const { page, page2 } = getPage(user1, user2);

                const emoji = await sendEmojitoLast(page);
                const resultText = await findTimeLineLastMessage(page, emoji, "emoji");
                expect(resultText).toEqual(emoji);
                const resultText2 = await findTimeLineLastMessage(page2, emoji, "emoji");
                expect(resultText2).toEqual(emoji);
            },
        },
        {
            it: "send reply message",
            async func(user1: User, user2: User) {
                const { page, page2 } = getPage(user1, user2);
                const text1 = `hellow-reply-${new Date().toISOString()}-${Math.random()}`;
                await replyToLastMessage(page, text1);

                const resultText = await findTimeLineText(page, text1);
                expect(text1).toEqual(resultText);
                const resultText2 = await findTimeLineText(page2, text1);

                expect(text1).toEqual(resultText2);
            },
        },
        {
            it: "send @somne message",
            async func(user1: User, user2: User) {
                const { page, page2 } = getPage(user1, user2);

                const pubkey2 = user2.pubkey;
                const text1 = `@${pubkey2} hellow-someone-${new Date().toISOString()}-${Math.random()}`;
                await sendMessage(page, text1);
                const resultText = await findTimeLineText(page, text1);
                expect(text1).toEqual(resultText);
                await page.waitForTimeout(1 * 1000);
                const resultText2 = await findTimeLineText(page2, text1);
                expect(text1).toEqual(resultText2);
            },
        },
        {
            it: "search room member",
            async func(user1: User, user2: User) {
                const { page, page2 } = getPage(user1, user2);

                const pubkey1 = user1.pubkey;
                const pubkey2 = user2.pubkey;
                const resultText = await findMemberName(page, pubkey2);
                const resultText2 = await findMemberName(page2, pubkey1);
                expect(resultText).not.toEqual("No results found!");
                expect(resultText2).not.toEqual("No results found!");
            },
        },
    ];
};
