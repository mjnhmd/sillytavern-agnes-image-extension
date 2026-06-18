const EXTENSION_NAME = 'sillytavern-agnes-image-extension';
const EXTENSION_TITLE = 'Agnes Image';
const AGNES_IMAGE_ENDPOINT = 'https://apihub.agnes-ai.com/v1/images/generations';
const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';

const DEFAULT_SETTINGS = {
    apiKey: '',
    mode: 'scene',
    size: '1024x768',
    messageCount: 8,
    customStyle: 'cinematic realistic illustration, high detail, natural lighting',
};

let settings = { ...DEFAULT_SETTINGS };
let lastImageUrl = '';

function getContext() {
    return window.SillyTavern?.getContext?.() || {};
}

function getExtensionStore() {
    const context = getContext();
    context.extensionSettings ||= {};
    context.extensionSettings[EXTENSION_NAME] ||= {};
    return context.extensionSettings[EXTENSION_NAME];
}

function loadSettings() {
    settings = { ...DEFAULT_SETTINGS, ...getExtensionStore() };
}

function saveSettings() {
    Object.assign(getExtensionStore(), settings);
    getContext().saveSettingsDebounced?.();
}

function setStatus(message, isError = false) {
    const status = document.querySelector('#agnes_image_status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('redText', isError);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function stripHtml(value) {
    const container = document.createElement('div');
    container.innerHTML = String(value ?? '');
    return container.textContent || container.innerText || '';
}

function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sanitizeForImagePrompt(value) {
    const withoutTags = stripHtml(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\[(?:The message is empty|.*?hidden.*?)\]/gi, ' ');

    const blockedPatterns = [
        /(?:阴茎|龟头|阴道|阴唇|乳头|裸体|裸露|性交|做爱|口交|肛交|高潮|射精|精液|跳蛋|性器|色情|性爱)/g,
        /\b(?:penis|vagina|vulva|nipple|nude|naked|sex|sexual|intercourse|oral sex|anal sex|orgasm|semen|porn)\b/gi,
    ];

    return normalizeWhitespace(
        blockedPatterns.reduce((text, pattern) => text.replace(pattern, ' '), withoutTags),
    );
}

function getMessageText(message) {
    if (!message) return '';
    const parts = [
        message.name ? `${message.name}:` : '',
        message.mes || message.message || message.content || '',
    ];
    return parts.filter(Boolean).join(' ');
}

function getRecentChatText() {
    const context = getContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const count = Math.max(1, Number(settings.messageCount) || DEFAULT_SETTINGS.messageCount);
    return chat
        .slice(-count)
        .map(getMessageText)
        .filter(Boolean)
        .join('\n');
}

function getActiveCharacterText() {
    const context = getContext();
    const character = Number.isInteger(context.characterId)
        ? context.characters?.[context.characterId]
        : null;

    if (!character) return '';

    return [
        `Name: ${character.name || ''}`,
        `Description: ${character.description || character.desc || ''}`,
        `Personality: ${character.personality || ''}`,
        `Scenario: ${character.scenario || ''}`,
    ].filter(Boolean).join('\n');
}

function buildScenePrompt(contextText) {
    return [
        'Create a safe-for-work scene illustration based on the following roleplay context.',
        'Focus on location, time of day, atmosphere, props, clothing, body language, and cinematic composition.',
        'Do not depict nudity, explicit sexual acts, exposed genitals, gore, or minors in sexualized framing.',
        `Style: ${settings.customStyle}.`,
        'Prompt must be in English visual-generation language.',
        '',
        'Context:',
        contextText,
    ].join('\n');
}

function buildCharacterPrompt(characterText, chatText) {
    return [
        'Create a safe-for-work character portrait based on the following roleplay context.',
        'Focus on face, hairstyle, clothing, posture, expression, temperament, and a simple background that matches the story.',
        'Do not depict nudity, explicit sexual acts, exposed genitals, gore, or minors in sexualized framing.',
        `Style: ${settings.customStyle}.`,
        'Prompt must be in English visual-generation language.',
        '',
        'Character profile:',
        characterText || 'No active character profile was available.',
        '',
        'Recent chat context:',
        chatText,
    ].join('\n');
}

function buildPrompt() {
    const chatText = sanitizeForImagePrompt(getRecentChatText()).slice(0, 5000);
    const characterText = sanitizeForImagePrompt(getActiveCharacterText()).slice(0, 2500);

    if (!chatText && !characterText) {
        throw new Error('当前没有可用于生成的聊天或角色内容');
    }

    return settings.mode === 'character'
        ? buildCharacterPrompt(characterText, chatText)
        : buildScenePrompt(chatText || characterText);
}

function extractImageUrl(response) {
    if (Array.isArray(response?.data) && response.data.length > 0) {
        return response.data[0]?.url || response.data[0]?.b64_json || '';
    }

    if (Array.isArray(response?.images) && response.images.length > 0) {
        return response.images[0]?.url || response.images[0] || '';
    }

    return response?.url || response?.image_url || '';
}

async function callAgnesImageApi(prompt) {
    const response = await fetch(AGNES_IMAGE_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: AGNES_IMAGE_MODEL,
            prompt,
            size: settings.size,
            extra_body: {
                response_format: 'url',
            },
        }),
    });

    const rawText = await response.text();
    let payload = {};
    try {
        payload = rawText ? JSON.parse(rawText) : {};
    } catch {
        payload = { raw: rawText };
    }

    if (!response.ok) {
        const message = payload?.error?.message || payload?.message || rawText || response.statusText;
        throw new Error(`Agnes API ${response.status}: ${message}`);
    }

    return payload;
}

function showResult(imageUrl, prompt) {
    lastImageUrl = imageUrl;
    const result = document.querySelector('#agnes_image_result');
    const preview = document.querySelector('#agnes_image_preview');
    const link = document.querySelector('#agnes_image_open');
    const promptBox = document.querySelector('#agnes_image_prompt');

    if (preview) preview.src = imageUrl;
    if (link) link.href = imageUrl;
    if (promptBox) promptBox.value = prompt;
    result?.classList.add('is-visible');
}

async function generateImage() {
    if (!settings.apiKey) {
        setStatus('请先填写 Agnes API Key', true);
        return;
    }

    try {
        setStatus('正在读取当前聊天并生成提示词...');
        const prompt = buildPrompt();
        document.querySelector('#agnes_image_prompt').value = prompt;
        setStatus('正在调用 Agnes Image...');
        const response = await callAgnesImageApi(prompt);
        const imageUrl = extractImageUrl(response);

        if (!imageUrl) {
            console.warn(`[${EXTENSION_TITLE}] Unexpected Agnes response`, response);
            throw new Error('Agnes 没有返回图片 URL');
        }

        showResult(imageUrl, prompt);
        setStatus('生成完成');
    } catch (error) {
        console.error(`[${EXTENSION_TITLE}]`, error);
        setStatus(error.message || String(error), true);
    }
}

function refreshPromptPreview() {
    try {
        document.querySelector('#agnes_image_prompt').value = buildPrompt();
        setStatus('提示词已从当前聊天刷新');
    } catch (error) {
        setStatus(error.message || String(error), true);
    }
}

async function copyImageUrl() {
    if (!lastImageUrl) {
        setStatus('当前还没有图片链接', true);
        return;
    }

    await navigator.clipboard.writeText(lastImageUrl);
    setStatus('图片链接已复制');
}

function bindSettingsEvents() {
    document.querySelector('#agnes_image_api_key')?.addEventListener('input', (event) => {
        settings.apiKey = event.target.value.trim();
        saveSettings();
    });

    document.querySelector('#agnes_image_mode')?.addEventListener('change', (event) => {
        settings.mode = event.target.value;
        saveSettings();
        refreshPromptPreview();
    });

    document.querySelector('#agnes_image_size')?.addEventListener('change', (event) => {
        settings.size = event.target.value;
        saveSettings();
    });

    document.querySelector('#agnes_image_message_count')?.addEventListener('change', (event) => {
        settings.messageCount = Math.min(30, Math.max(1, Number(event.target.value) || DEFAULT_SETTINGS.messageCount));
        event.target.value = String(settings.messageCount);
        saveSettings();
        refreshPromptPreview();
    });

    document.querySelector('#agnes_image_style')?.addEventListener('input', (event) => {
        settings.customStyle = event.target.value.trim();
        saveSettings();
    });

    document.querySelector('#agnes_image_generate')?.addEventListener('click', generateImage);
    document.querySelector('#agnes_image_refresh_prompt')?.addEventListener('click', refreshPromptPreview);
    document.querySelector('#agnes_image_copy_url')?.addEventListener('click', copyImageUrl);
}

function getSettingsHtml() {
    return `
        <div id="agnes_image_extension" class="agnes-image-extension">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Agnes Image</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="agnes-row">
                        <label for="agnes_image_api_key">API Key</label>
                        <input id="agnes_image_api_key" type="password" autocomplete="off" value="${escapeHtml(settings.apiKey)}" placeholder="Agnes API Key" />
                    </div>
                    <div class="agnes-row">
                        <label for="agnes_image_mode">生成类型</label>
                        <select id="agnes_image_mode">
                            <option value="scene" ${settings.mode === 'scene' ? 'selected' : ''}>场景图</option>
                            <option value="character" ${settings.mode === 'character' ? 'selected' : ''}>角色图</option>
                        </select>
                    </div>
                    <div class="agnes-row">
                        <label for="agnes_image_size">尺寸</label>
                        <select id="agnes_image_size">
                            ${['1024x768', '768x1024', '1024x1024', '1152x768', '768x1152'].map((size) => (
                                `<option value="${size}" ${settings.size === size ? 'selected' : ''}>${size}</option>`
                            )).join('')}
                        </select>
                    </div>
                    <div class="agnes-row">
                        <label for="agnes_image_message_count">聊天条数</label>
                        <input id="agnes_image_message_count" type="number" min="1" max="30" step="1" value="${escapeHtml(settings.messageCount)}" />
                    </div>
                    <div class="agnes-row">
                        <label for="agnes_image_style">画风</label>
                        <input id="agnes_image_style" type="text" value="${escapeHtml(settings.customStyle)}" />
                    </div>
                    <div class="agnes-actions">
                        <button id="agnes_image_generate" class="menu_button" type="button">从当前聊天生成</button>
                        <button id="agnes_image_refresh_prompt" class="menu_button" type="button">刷新提示词</button>
                    </div>
                    <div id="agnes_image_status" class="agnes-status"></div>
                    <textarea id="agnes_image_prompt" class="agnes-prompt" readonly placeholder="提示词预览"></textarea>
                    <div id="agnes_image_result" class="agnes-result">
                        <img id="agnes_image_preview" class="agnes-preview" alt="Agnes generated preview" />
                        <div class="agnes-actions">
                            <a id="agnes_image_open" class="menu_button" href="#" target="_blank" rel="noopener">打开图片</a>
                            <button id="agnes_image_copy_url" class="menu_button" type="button">复制链接</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function mountSettings() {
    if (document.querySelector('#agnes_image_extension')) return;

    const target = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!target) {
        console.warn(`[${EXTENSION_TITLE}] Extensions settings container was not found`);
        return;
    }

    target.insertAdjacentHTML('beforeend', getSettingsHtml());
    bindSettingsEvents();
    refreshPromptPreview();
}

function init() {
    loadSettings();
    const context = getContext();
    const readyEvent = context.eventTypes?.APP_READY || context.event_types?.APP_READY;

    if (context.eventSource && readyEvent) {
        context.eventSource.once(readyEvent, mountSettings);
    }

    window.setTimeout(mountSettings, 1000);
    console.info(`[${EXTENSION_TITLE}] loaded`);
}

init();
