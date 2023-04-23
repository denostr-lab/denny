import puppeteer, { Page } from "puppeteer";
import { PageAndBrowser, userInfo } from "./@types/index";
export const sleep = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

export const createBrowserAndPage = async (): Promise<PageAndBrowser> => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({
        width: 1364,
        height: 764,
    });
    return { browser, page };
};
export const login = async (page: Page, pubKey: string) => {
    await page.goto("http://localhost:8081/", { timeout: 90000 });
    await page.evaluate(() => {});
    await page.$eval('button[type="button"]', (el) => el.click());
    await page.waitForSelector("input[name='privatekey']");
    await page.$eval("input[name='privatekey']", (el) => {
        el.focus();
    });
    await page.keyboard.sendCharacter(pubKey);
    await page.keyboard.press("Enter");
};
export const logout = async (page: Page) => {
    await page.waitForSelector("button[data-testid=logout]");
    await page.$eval("button[data-testid=logout]", (el) => {
        el.click();
    });
    await page.waitForTimeout(1 * 1000);
    await page.waitForSelector("button[data-testid=confirm]");
    await page.$eval("button[data-testid=confirm]", (el) => {
        el.click();
    });
};
export const searchRoomMember = async (page: Page, text: string) => {
    await page.$eval(".people-drawer__sticky .people-search input", (el) => {
        el.value = "";
        el.focus();
    });
    await page.waitForTimeout(0.5 * 1000);

    await page.keyboard.sendCharacter(text);
    await page.waitForSelector(".people-drawer__sticky .people-search");
    await page.$eval(".people-selector__container button", (el) => {
        return el.click();
    });
    await page.waitForTimeout(1 * 1000);

    await page.waitForSelector(".profile-viewer__buttons button");
    await page.$eval(".profile-viewer__buttons button", (el) => {
        el.click();
    });
    await page.waitForTimeout(4 * 1000);
};

export const findTimeLineLastMessage = (page: Page, text: string, type: string = "image"): Promise<string> => {
    let t: number;
    let count = 0;
    return new Promise((res) => {
        t = setInterval(async () => {
            count += 1;
            let name = "";
            try {
                if (type === "image") {
                    name = await page.$eval(".timeline__wrapper>div:last-child .message__body img", (el) => {
                        return el.alt;
                    });
                } else if (type === "emoji") {
                    name = await page.$eval(".timeline__wrapper>div:last-child .message__reactions img", (el) => {
                        return el.alt;
                    });
                } else {
                    name = await page.$eval(".timeline__wrapper>div:last-child .file-header p", (el) => {
                        return el.innerText;
                    });
                }
            } catch (e) {}

            if (name === text) {
                clearInterval(t);
                res(name);
            } else if (count > 10) {
                // 错误了
                clearInterval(t);
                res("");
            }
        }, 1000);
    });
};

export const findTimeLineText = async (page: Page, text: string): Promise<string> => {
    // 在时间tiemlien 中找到消息
    let t: number;
    let count = 0;
    const getText = async (query: string) => {
        const res = await page.$$eval(
            query,
            (el, matchText) => {
                let result = "";
                for (const [index, i] of el.entries()) {
                    if (i.innerText === matchText) {
                        result = i.innerText;
                        break;
                    }
                }

                return result;
            },
            text,
        );
        return res;
    };
    return await new Promise((res) => {
        t = setInterval(async () => {
            let name = "";
            try {
                name = await getText(".timeline__wrapper>div .message__body div");
                if (!name) {
                    name = await getText(".timeline__wrapper>div .message__body p");
                }
            } catch (e) {}
            if (name === text) {
                clearInterval(t);
                res(name);
            } else if (count > 10) {
                expect(name).toEqual(text);
                clearInterval(t);
                // 错误了
            }
            count += 1;
        }, 1000);
    });
};

export const findLastFileSourceName = async (page: Page): Promise<string> => {
    await page.waitForSelector(".timeline__wrapper");
    await page.hover(".timeline__wrapper>div:last-child");
    await page.waitForTimeout(1 * 1000);
    await page.waitForSelector(".timeline__wrapper>div:last-child .message__options button:nth-child(3)");

    await page.$eval(".timeline__wrapper>div:last-child .message__options button:nth-child(3)", (el) => {
        el.click();
    });

    await page.waitForSelector(
        ".timeline__wrapper>div:last-child .message__options .context-menu__item:nth-child(3) button",
    );
    await page.$eval(
        ".timeline__wrapper>div:last-child .message__options .context-menu__item:nth-child(3) button",
        (el) => {
            el.click();
        },
    );
    await page.waitForSelector(".view-source__card code");
    await page.waitForTimeout(1 * 1000);

    const resultStr = await page.$eval(".view-source__card code", (el) => {
        const result = JSON.parse(el.innerText);
        let resultStr = "";
        if (result?.content?.url) {
            resultStr = result.content.url
                .replace("https://nostr.build/i/nostr.", "")
                .replace("https://nostr.build/av/nostr.", "");
        }
        return resultStr;
    });

    await page.waitForTimeout(1 * 1000);
    try {
        await page.$eval(".pw__content .header button", (el) => {
            el.click();
        });
    } catch (e) {}

    return resultStr;
};

export const sendEmojitoLast = async (page: Page) => {
    await page.waitForSelector(".timeline__wrapper");
    await page.hover(".timeline__wrapper>div:last-child");
    await page.waitForSelector(".timeline__wrapper");
    await page.$eval(".timeline__wrapper>div:last-child .message__options button", (el) => {
        el.click();
    });
    await page.waitForSelector(".emoji-board .emoji-row span");
    const clickAlt = await page.$eval(".emoji-board .emoji-row span img", (el) => {
        return el.alt;
    });
    await page.$eval(".emoji-board .emoji-row span img", (el) => {
        el.click();
    });
    await page.$eval(".room-input__input-container textarea", async (el) => {
        el.click();
    });
    await page.waitForTimeout(1 * 1000);
    return clickAlt;
};
export const sendMessage = async (page: Page, content: string, delay: number = 0) => {
    await page.waitForSelector(".room-input__input-container");
    await page.$eval(".room-input__input-container textarea", async (el) => {
        el.focus();
    });
    await page.keyboard.sendCharacter(content);
    await page.waitForTimeout(0.5 * 1000 + delay);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2 * 1000);
};
export const sendFile = async (page: Page, path: string = "spec/test.png", delay: number = 0) => {
    await page.waitForSelector(".room-input__input-container");
    const elementHandle = await page.$("input[type=file]");
    await elementHandle!.uploadFile(path);

    await page.waitForSelector(".room-attachment__info");
    await page.waitForTimeout(1 * 1000 + delay);
    await page.$eval(".room-input__input-container textarea", async (el) => {
        el.focus();
    });
    await page.waitForTimeout(0.5 * 1000 + delay);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(1 * 1000);
};
export const replyToLastMessage = async (page: Page, content: string, delay: number = 0) => {
    await page.waitForSelector(".timeline__wrapper");
    await page.hover(".timeline__wrapper>div:last-child");
    await page.waitForSelector(".timeline__wrapper");
    await page.$eval(".timeline__wrapper>div:last-child .message__options button:nth-child(2)", (el) => {
        el.click();
    });
    await page.waitForTimeout(0.5 * 1000);
    await sendMessage(page, content, delay);
};

export const findMemberName = async (page: Page, pubkey: string) => {
    await page.waitForSelector(".people-drawer__sticky .people-search");
    await page.$eval(".people-drawer__sticky .people-search input", (el) => {
        el.value = "";
        el.focus();
    });
    await page.waitForTimeout(0.5 * 1000);
    await page.keyboard.type(pubkey);
    await page.waitForTimeout(1 * 1000);
    let resultName = await page.$eval(".people-selector__container .people-selector p", (el) => {
        return el.innerText;
    });
    return resultName;
};
export const privateChatFromRoom = async (page: Page, key: string, delay: number = 0) => {
    // 从房间中找到一个用户并且发一条私聊消息
    await searchRoomMember(page, key);
    // 随机加入一个房间
    const text = `private message ${Math.random()} ${new Date().toISOString()}`;
    await sendMessage(page, text, delay);

    return { text };
};
export const enterPublicRoom = async (page: Page, roomName: string = "public room global", type: string = "pubkey") => {
    await page.waitForSelector(".header button");
    const header = await page.$(".header");
    await header?.$eval("button", (e) => {
        e.click();
    });
    await page.waitForSelector(".context-menu__item");
    await page.waitForTimeout(1 * 1000);

    await page.$$eval(".context-menu__item button", (el) => {
        el[1].click();
    });
    await page.waitForSelector(".public-rooms__input-wrapper");
    await page.$eval(".public-rooms__input-wrapper input", (el) => {
        el.focus();
    });
    await page.keyboard.sendCharacter(roomName);
    await page.waitForTimeout(0.5 * 1000);
    await page.keyboard.press("Enter");

    await page.waitForTimeout(3 * 1000);
    await page.$eval(".public-rooms__form button", (el) => {
        el.click();
    });
    // 加入一个房间
    await page.waitForSelector(".public-rooms__content button");
    await page.waitForTimeout(3 * 1000);

    await page.$eval(".public-rooms__content button", (el) => {
        el.click();
    });
    try {
        await page.$eval(".pw__content .header button", (el) => {
            el.click();
        });
    } catch (e) {}
    await page.waitForSelector(".room-selector__content");
    await page.waitForTimeout(4 * 1000);

    await page.$$eval(
        ".room-selector__content",
        (el, roomName) => {
            for (const i of el) {
                if (i.querySelectorAll("h4")?.[0]?.innerText === roomName) {
                    i.click();
                    break;
                } else if (i.querySelectorAll?.("p")?.[0].innerText === roomName) {
                    i.click();
                    break;
                }
            }
        },
        roomName,
    );
    await page.waitForSelector(".room-input__input-container");
};

export const findPrivateMessageRoomWithPubKey = async (
    page: Page,
    pubkey: string,
    clickRoom: boolean = true,
): Promise<userInfo> => {
    await page.waitForSelector("button[data-testid=people-tab]");
    await page.$eval("button[data-testid=people-tab]", (el) => {
        el.click();
    });

    await page.waitForSelector("button[data-testid=start-dm]");
    await page.$eval("button[data-testid=start-dm]", (el) => {
        el.click();
    });
    await page.waitForTimeout(1 * 1000);

    await page.waitForSelector("input[data-testid=invite-user-input]");

    await page.$eval("input[data-testid=invite-user-input]", (el) => {
        el.focus();
    });
    await page.keyboard.sendCharacter(pubkey);
    await page.waitForTimeout(1 * 1000);
    await page.$eval("input[data-testid=invite-user-input]", (el) => {
        el.focus();
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2 * 1000);
    await page.waitForSelector(".room-tile__content");
    const resName = await page.$eval(".room-tile__content h4", (el) => {
        return el.innerText;
    });
    const resPubkey = await page.$eval(".room-tile__content p", (el) => {
        return el.innerText;
    });
    if (clickRoom) {
        await page.waitForSelector(".room-tile__options button");
        await page.$eval(".room-tile__options button", (el) => {
            el.click();
        });
        await page.waitForTimeout(2 * 1000);
    }
    return {
        pubkey: resPubkey,
        name: resName,
    };
};
export const createGroupChat = async (page: Page, roomName: string, isPrivate: boolean = false) => {
    await page.waitForSelector(".header button");
    const header = await page.$(".header");
    await header?.$eval("button", (e) => {
        e.click();
    });
    await page.waitForSelector(".context-menu__item");

    await page.$eval(".context-menu__item button", (el) => {
        el.click();
    });
    await page.waitForSelector(".ReactModal__Content--after-open");

    await page.$eval(".ReactModal__Content--after-open textarea", async (el) => {
        el.focus();
    });
    if (isPrivate) {
        await page.$eval(".ReactModal__Content--after-open .setting-tile__options button", async (el) => {
            el.click();
        });
        await page.waitForSelector(".tippy-content");

        await page.$$eval(".tippy-content button", async (el) => {
            el.forEach((element) => {
                if (element.innerText === "Private (invite only)") {
                    element.click();
                }
            });
        });
    }

    const name = roomName;
    await page.keyboard.type(name);

    await page.$eval(".ReactModal__Content--after-open input", async (el) => {
        el.focus();
    });
    await page.keyboard.type(name);

    await page.$eval(".create-room__name-wrapper button", (el) => {
        el.click();
    });
    await page.waitForTimeout(5 * 1000);
    // 查找是否有创建的房间
    await page.waitForSelector(".room-selector__content");
    const resultName = await page.$$eval(
        ".room-selector__content",
        (el, name) => {
            let result = "";
            el.map((i) => {
                const innerText = i.querySelectorAll("p")?.[1]?.innerText;
                const innerText1 = i.querySelectorAll("p")?.[0]?.innerText;
                if (innerText === name || innerText1 === name) {
                    result = name;
                }
            });

            return result;
        },
        name,
    );

    // expect(resultName).toEqual(name);

    await page.waitForSelector(".room-input__input-container");
    await page.waitForTimeout(2 * 1000);
};

export const updateGroupChatMeta = async (page: Page, roomName: string) => {
    await page.waitForSelector(".room-header__btn");
    await page.$eval(".room-header__btn", (el) => {
        el.click();
    });
    await page.waitForSelector(".room-profile__display");

    const elementHandle = await page.$(".img-upload__wrapper input[type=file]");
    await elementHandle!.uploadFile("spec/test.png");
    await page.waitForTimeout(5 * 1000);
    await page.$eval(".room-profile__display button", (el) => {
        el.click();
    });

    await page.waitForSelector(".room-profile__edit-form");

    const name = roomName;
    await page.$eval(".room-profile__edit-form input", async (el) => {
        el.value = "";
        el.focus();
    });

    await page.keyboard.sendCharacter(name);

    await page.$eval(".room-profile__edit-form textarea", async (el) => {
        el.value = "";
        el.focus();
    });
    await page.keyboard.sendCharacter(name);

    await page.$eval(".room-profile__edit-form button", (el) => {
        el.click();
    });
    await page.waitForTimeout(10 * 1000);

    // 查找是否房间名更新了
    await page.waitForSelector(".room-selector__content");
    let resultName = await page.$$eval(
        ".room-selector__content",
        (el, name) => {
            let result = "";
            el.map((i) => {
                const innerText = i.querySelectorAll("p")?.[1]?.innerText || i.querySelectorAll("p")?.[0]?.innerText;
                if (innerText === name) {
                    result = name;
                }
            });
            return result;
        },
        name,
    );

    expect(resultName).toEqual(name);
    // 刷新验证
    // await page.reload();
    // // 查找是否房间名更新了
    // await page.waitForSelector(".room-selector__content");
    // await page.waitForTimeout(10 * 1000);

    // resultName = await page.$$eval(
    //     ".room-selector__content",
    //     (el, name) => {
    //         let result = "";
    //         el.map((i) => {
    //             const innerText = i.querySelectorAll("p")?.[1]?.innerText || i.querySelectorAll("p")?.[0]?.innerText;
    //             if (innerText === name) {
    //                 result = name;
    //             }
    //         });
    //         return result;
    //     },
    //     name,
    // );
    // expect(resultName).toEqual(name);
};
export const invitePrivateGroupUser = async (page: Page, pubkey: string) => {
    await page.waitForSelector(".people-drawer .header button");
    await page.$eval(".people-drawer .header button", async (el) => {
        el.click();
    });
    await page.waitForTimeout(1 * 1000);

    await page.waitForSelector("input[data-testid=invite-user-input]");
    await page.$eval("input[data-testid=invite-user-input]", (el) => {
        el.focus();
    });
    await page.keyboard.sendCharacter(pubkey);
    await page.waitForTimeout(1 * 1000);
    await page.$eval("button[data-testid=invite-user-invite]", async (el) => {
        el.click();
    });
    await page.waitForTimeout(2 * 1000);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2 * 1000);
};

export const kickPrivateGroupUser = async (page: Page, pubkey: string) => {
    await page.$eval(".people-drawer__sticky .people-search input", (el) => {
        el.value = "";
        el.focus();
    });
    await page.waitForTimeout(0.5 * 1000);

    await page.keyboard.sendCharacter(pubkey);
    await page.waitForSelector(".people-drawer__sticky .people-search");
    await page.$eval(".people-selector__container button", (el) => {
        return el.click();
    });
    await page.waitForTimeout(1 * 1000);

    await page.waitForSelector(".moderation-tools button");
    await page.$eval(".moderation-tools button", (el) => {
        el.click();
    });
    await page.waitForTimeout(4 * 1000);
};
export const leaveRoom = async (page: Page) => {
    await page.waitForSelector(".room-header__btn");
    await page.$eval(".room-header__btn", (el) => {
        el.click();
    });
    await page.waitForTimeout(2 * 1000);

    await page.$eval(".room-settings__card .context-menu__item:nth-child(3) button", (el) => {
        el.click();
    });
    await page.waitForTimeout(2 * 1000);
    await page.waitForSelector(".confirm-dialog__btn button");
    await page.$eval(".confirm-dialog__btn button", (el) => {
        el.click();
    });
    await page.waitForTimeout(2 * 1000);
};

export const searchLocalUserAndEnterRoom = async (page: Page, pubkey: string) => {
    await page.waitForSelector(".sidebar__sticky .sticky-container button");

    await page.$eval(".sidebar__sticky .sticky-container button", (el) => {
        el.click();
    });
    await page.waitForTimeout(1 * 1000);
    await page.waitForSelector(".search-dialog__input input");

    await page.$eval(".search-dialog__input input", (el) => {
        el.focus();
    });
    await page.keyboard.sendCharacter(pubkey);
    await page.waitForSelector(".search-dialog__content button");
    await page.$eval(".search-dialog__content button", (el) => {
        el.click();
    });
    await page.waitForTimeout(2 * 1000);
};

export const enterRoomFromRoomList = async (page: Page, name: string) => {
    await page.waitForSelector(".room-selector__content p");
    await page.$$eval(
        ".room-selector__content p",
        (el, name) => {
            for (const i of el) {
                if (i.innerText === name) {
                    i?.parentNode?.click?.();
                    break;
                }
            }
        },
        name,
    );
    await page.waitForTimeout(1 * 1000);
};

export const findRoomFromRoomList = async (page: Page, name: string = "public room global"): Promise<string> => {
    await page.waitForTimeout(5 * 1000);

    await page.waitForSelector(".room-selector__content p");
    const result = await page.$$eval(
        ".room-selector__content p",
        (el, name) => {
            let result = "";
            for (const i of el) {
                if (i.innerText === name) {
                    result = name;
                    break;
                }
            }
            return result;
        },
        name,
    );
    await page.waitForTimeout(1 * 1000);
    return result;
};
export const openUserMetaInfo = async (page: Page) => {
    await page.waitForSelector("button[data-testid='my-self-avatar']");
    await page.$eval("button[data-testid=my-self-avatar]", (el) => {
        el.click();
    });
};
export const updateUserMeta = async (page: Page, name: string) => {
    await openUserMetaInfo(page);

    await page.waitForSelector("input[data-testid=upload-self-picture-input]");
    const elementHandle = await page.$("input[data-testid=upload-self-picture-input]");
    await elementHandle!.uploadFile("spec/test.png");
    await page.waitForTimeout(5 * 1000);
    await page.$eval("button[data-testid=edit-self-name]", (el) => {
        el.click();
    });
    await page.waitForSelector("input[data-testid=my-name-input]");
    await page.$eval("input[data-testid=my-name-input]", async (el) => {
        el.value = "";
        el.focus();
    });
    await page.keyboard.sendCharacter(name);
    await page.$eval("button[data-testid=save-my-name]", (el) => {
        el.click();
    });
    await page.waitForTimeout(2 * 1000);
};

export const findMyUserMeta = async (page: Page): Promise<string> => {
    await page.waitForSelector("h2[data-testid=my-name]");
    const resultName = await page.$eval("h2[data-testid=my-name]", (el) => {
        return el.innerText;
    });
    return resultName;
};

export const getReplayConnectCount = async (page: Page): Promise<number> => {
    await page.waitForSelector("small[data-testid=relay-count]");
    await page.waitForTimeout(5 * 1000);
    let relayConnectCount = Number(
        await page.$eval("small[data-testid=relay-count]", async (el) => {
            return el.innerText;
        }),
    );
    return relayConnectCount;
};
