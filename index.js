const EXTENSION_NAME = 'sillytavern-agnes-image-extension';
const EXTENSION_TITLE = 'Agnes Image';
const AGNES_IMAGE_ENDPOINT = 'https://apihub.agnes-ai.com/v1/images/generations';
const AGNES_TEXT_ENDPOINT = 'https://apihub.agnes-ai.com/v1/chat/completions';
const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';
const AGNES_TEXT_MODEL = 'agnes-2.0-flash';
const IMAGE_SIZE = '1024x768';
const CHAT_MESSAGE_COUNT = 10;
const AI_PROMPT_RESPONSE_LENGTH = 420;
const TEXT_AI_TIMEOUT_MS = 45000;

const DEFAULT_SETTINGS = {
    apiKey: '',
};

let settings = { ...DEFAULT_SETTINGS };
let lastImageUrl = '';
let currentMode = 'scene';

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
    const store = getExtensionStore();
    settings = {
        ...DEFAULT_SETTINGS,
        apiKey: store.apiKey || '',
    };

    // Keep only the API key in persistent extension settings.
    Object.keys(store).forEach((key) => {
        if (key !== 'apiKey') delete store[key];
    });
}

function saveSettings() {
    const store = getExtensionStore();
    Object.keys(store).forEach((key) => delete store[key]);
    store.apiKey = settings.apiKey;
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

function getFieldValue(id) {
    const element = document.getElementById(id);
    return element ? String(element.value || element.textContent || '') : '';
}

function removeUnsafeBypassText(value) {
    return String(value ?? '')
        .replace(/(?:jailbreak|破限|越狱|绕过|无视规则|解除限制|bypass|ignore policy|ignore safety)/gi, ' ')
        .replace(/[A-H]\s*罩杯/gi, ' ')
        .replace(/\b[A-H]\s*cup\b/gi, ' ')
        .replace(/(?:阴茎|龟头|阴道|阴唇|乳头|裸体|裸露|赤裸|性交|交合|做爱|口交|肛交|高潮|射精|精液|跳蛋|性器|色情|性爱|性斗|骰值|体质|经验|罩杯|胸部|乳房|睡裙|贴身)/g, ' ')
        .replace(/\b(?:penis|vagina|vulva|nipple|nude|naked|sex|sexual|intercourse|oral sex|anal sex|orgasm|semen|porn)\b/gi, ' ');
}

function sanitizeForImagePrompt(value) {
    const text = stripHtml(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\[(?:The message is empty|.*?hidden.*?)\]/gi, ' ');

    return normalizeWhitespace(removeUnsafeBypassText(text));
}

function getMessageText(message) {
    if (!message) return '';
    return [
        message.name ? `${message.name}:` : '',
        message.mes || message.message || message.content || '',
    ].filter(Boolean).join(' ');
}

function getActiveCharacter() {
    const context = getContext();
    const characterId = Number(context.characterId);
    if (!Number.isInteger(characterId)) return null;
    return context.characters?.[characterId] || null;
}

function getRecentChatText() {
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    return chat
        .slice(-CHAT_MESSAGE_COUNT)
        .map(getMessageText)
        .filter(Boolean)
        .join('\n');
}

function getPromptSourceText() {
    return [
        'CURRENT CHARACTER CARD:',
        sanitizeForImagePrompt(getActiveCharacterText()) || '(none)',
        '',
        'RELATED CHARACTER CARDS:',
        sanitizeForImagePrompt(getRelatedCharactersText()) || '(none)',
        '',
        'RECENT CHAT:',
        sanitizeForImagePrompt(getRecentChatText()) || '(none)',
        '',
        'CURRENT VISUAL PRESET:',
        getPresetVisualHints() || '(none)',
    ].join('\n').slice(0, 9000);
}

function getActiveCharacterText() {
    const character = getActiveCharacter();
    if (!character) return '';

    return [
        `Name: ${character.name || ''}`,
        `Description: ${character.description || character.desc || ''}`,
        `Personality: ${character.personality || ''}`,
        `Scenario: ${character.scenario || ''}`,
        `Creator notes: ${character.creator_notes || ''}`,
    ].filter(Boolean).join('\n');
}

function normalizePersonName(value) {
    const name = sanitizeForImagePrompt(value)
        .split(/[|｜:：,，/\\\-—\s]/)[0]
        .replace(/[「」『』"'“”]/g, '')
        .trim();

    if (!name || name.length > 24) return '';
    if (/^(assistant|system|sillytavern|user|narity)$/i.test(name)) return '';
    return name;
}

function getCandidateNames(rawText) {
    const context = getContext();
    const names = new Set();
    const activeCharacter = getActiveCharacter();

    [
        activeCharacter?.name,
        context.name2,
        ...(Array.isArray(context.chat) ? context.chat.slice(-CHAT_MESSAGE_COUNT).map(message => message.name) : []),
    ].forEach((name) => {
        const normalized = normalizePersonName(name);
        if (normalized) names.add(normalized);
    });

    const roleMatches = String(rawText || '').matchAll(/(?:在场角色|角色|人物|登场人物)[:：]\s*([^<\n。]{1,120})/gi);
    for (const match of roleMatches) {
        match[1].split(/[、,，;；\s-]+/).forEach((part) => {
            const normalized = normalizePersonName(part);
            if (normalized) names.add(normalized);
        });
    }

    return [...names].slice(0, 4);
}

function findCharacterByName(name) {
    const characters = Array.isArray(getContext().characters) ? getContext().characters : [];
    return characters.find(character => character?.name === name)
        || characters.find(character => String(character?.name || '').includes(name) || name.includes(String(character?.name || '')));
}

function getRelatedCharactersText() {
    const rawText = `${getActiveCharacterText()}\n${getRecentChatText()}`;
    const activeCharacter = getActiveCharacter();

    return getCandidateNames(rawText)
        .map(findCharacterByName)
        .filter(character => character && character !== activeCharacter)
        .map(character => [
            `Name: ${character.name || ''}`,
            `Description: ${character.description || character.desc || ''}`,
            `Personality: ${character.personality || ''}`,
            `Scenario: ${character.scenario || ''}`,
            `Creator notes: ${character.creator_notes || ''}`,
        ].filter(Boolean).join('\n'))
        .join('\n\n')
        .slice(0, 3000);
}

function translateVisualTerms(value) {
    return String(value || '')
        .replace(/女/g, 'female')
        .replace(/男/g, 'male')
        .replace(/(\d+)\s*岁/g, '$1 years old')
        .replace(/国际时尚杂志《?Vogue》?A国版主编/g, 'fashion magazine editor in chief')
        .replace(/时尚杂志/g, 'fashion magazine')
        .replace(/主编/g, 'editor in chief')
        .replace(/红色大波浪长卷发/g, 'red wavy long hair')
        .replace(/大波浪长卷发/g, 'wavy long hair')
        .replace(/长卷发/g, 'long curly hair')
        .replace(/正红色唇膏/g, 'red lipstick')
        .replace(/红色唇膏/g, 'red lipstick')
        .replace(/西装套装/g, 'business suit')
        .replace(/真丝衬衫/g, 'silk blouse')
        .replace(/高跟鞋/g, 'high heels')
        .replace(/连衣裙/g, 'dress')
        .replace(/白色帆布鞋/g, 'white canvas shoes')
        .replace(/浅薄荷色碎花/g, 'light mint floral')
        .replace(/黑色/g, 'black')
        .replace(/酒红色/g, 'burgundy')
        .replace(/红色/g, 'red')
        .replace(/白色/g, 'white')
        .replace(/温柔/g, 'gentle')
        .replace(/强势/g, 'confident')
        .replace(/成熟/g, 'mature')
        .replace(/优雅/g, 'elegant');
}

function extractCharacterVisualLines(character) {
    if (!character) return [];

    const text = [
        character.name ? `name: ${character.name}` : '',
        character.description || character.desc || '',
        character.personality || '',
        character.scenario || '',
        character.creator_notes || '',
    ].filter(Boolean).join('\n');

    const visualKeywords = /(姓名|年龄|性别|身份|职业|外貌|体型|身高|发色|发型|面部|眼睛|穿着|服装|衣服|职场|居家|personality|appearance|hair|eyes|outfit|clothing|role|age|gender)/i;

    return text
        .split(/\r?\n/)
        .map(line => sanitizeForImagePrompt(line).replace(/^\s*[-*•]+\s*/, '').trim())
        .filter(line => line && visualKeywords.test(line))
        .map(line => line
            .replace(/姓名/g, 'name')
            .replace(/年龄/g, 'age')
            .replace(/性别/g, 'gender')
            .replace(/身份|职业/g, 'role')
            .replace(/外貌特征|外貌/g, 'appearance')
            .replace(/体型/g, 'body type')
            .replace(/身高/g, 'height')
            .replace(/发色|发型/g, 'hair')
            .replace(/面部/g, 'face')
            .replace(/穿着|服装|衣服/g, 'outfit')
            .replace(/职场/g, 'work outfit')
            .replace(/居家/g, 'casual home outfit'))
        .map(translateVisualTerms)
        .map(line => line.slice(0, 180))
        .slice(0, 10);
}

function getCharacterVisualBrief(rawText) {
    const names = getCandidateNames(rawText);
    const sections = [];

    for (const name of names) {
        const character = findCharacterByName(name);
        const visualLines = extractCharacterVisualLines(character);
        if (visualLines.length > 0) {
            sections.push(`Character ${name}: ${visualLines.join('; ')}`);
        } else {
            sections.push(`Character ${name}: fictional adult character, expressive face, detailed outfit, story-matching temperament`);
        }
    }

    if (sections.length === 0) {
        return 'fictional adult character, expressive face, detailed outfit, calm dramatic temperament';
    }

    return normalizeWhitespace(sections.join('\n')).slice(0, 1200);
}

function getPresetVisualHints() {
    const sdPrefix = sanitizeForImagePrompt(getFieldValue('sd_prompt_prefix')).slice(0, 500);
    const sdCharacter = sanitizeForImagePrompt(getFieldValue('sd_character_prompt')).slice(0, 500);
    const sdNegative = sanitizeForImagePrompt(getFieldValue('sd_negative_prompt')).slice(0, 500);
    const jailbreakRaw = getFieldValue('jailbreak_prompt_quick_edit_textarea');
    const hasJailbreakPreset = normalizeWhitespace(jailbreakRaw).length > 0;

    return [
        sdPrefix ? `Image positive style preset: ${sdPrefix}` : '',
        sdCharacter ? `Character image preset: ${sdCharacter}` : '',
        hasJailbreakPreset
            ? 'The current preset suggests strong fictional drama; use only that general mood.'
            : '',
    ].filter(Boolean).join('\n');
}

function extractSceneBrief(chatText, characterText) {
    const raw = `${chatText}\n${characterText}`;
    const clean = sanitizeForImagePrompt(raw)
        .replace(/\{[^{}]{0,1200}\}/g, ' ')
        .replace(/<JSONPatch>[\s\S]*?<\/JSONPatch>/gi, ' ')
        .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, ' ');

    const sceneMatch = clean.match(/scene[:：]\s*([^<\n。]{1,80})/i);
    const timeMatch = clean.match(/time[:：]\s*([^<\n。]{1,80})/i);
    const placeMatch = clean.match(/(?:当前地点|当前位置|location)[:：\"\\/\s]+([^,\"，。<\n]{1,40})/i);
    const briefParts = [
        sceneMatch ? `setting: ${sceneMatch[1]}` : '',
        placeMatch ? `place: ${placeMatch[1]}` : '',
        timeMatch ? `time: ${timeMatch[1]}` : '',
    ].filter(Boolean);

    if (briefParts.length > 0) {
        return normalizeWhitespace(briefParts.join('; ')).slice(0, 700);
    }

    return 'an atmospheric story scene with fictional characters';
}

function makePublicSafeBrief(value) {
    const text = sanitizeForImagePrompt(value)
        .replace(/卧室|床上|主卧|家/g, 'quiet private interior')
        .replace(/厕所|浴室/g, 'interior hallway')
        .replace(/欢乐谷/g, 'amusement park')
        .replace(/鬼屋/g, 'haunted house attraction')
        .replace(/雨后初歇|雨后/g, 'after rain')
        .replace(/空调低鸣/g, 'quiet indoor ambience')
        .replace(/月影|月光/g, 'soft moonlight')
        .replace(/闷热夏夜|夏夜/g, 'humid summer night')
        .replace(/暧昧|情欲|欲望|亲密/g, 'dramatic emotional tension')
        .replace(/\b(?:bedroom|bed)\b/gi, 'quiet private interior');

    return normalizeWhitespace(text).slice(0, 800);
}

function buildScenePrompt(visualBrief, characterBrief, presetHints) {
    return [
        'Cinematic realistic illustration.',
        visualBrief || 'A quiet atmospheric story scene.',
        characterBrief ? `Featuring: ${characterBrief}` : 'Fictional adult characters with expressive faces and detailed outfits.',
        'Fully dressed people in natural relaxed poses, emotional atmosphere, coherent lighting, clear composition, high detail.',
        presetHints || 'best quality, masterpiece.',
    ].filter(Boolean).join('\n');
}

function buildCharacterPrompt(characterBrief, sceneBrief, presetHints) {
    return [
        'High quality character concept art portrait.',
        characterBrief || 'A fictional adult character with a calm dramatic mood.',
        sceneBrief ? `Background mood: ${sceneBrief}` : '',
        'Fully dressed character, expressive eyes, clear face, detailed outfit, natural posture, simple story-matching background, coherent lighting.',
        presetHints || 'best quality, masterpiece.',
    ].filter(Boolean).join('\n');
}

function buildPrompt(mode) {
    const rawChatText = getRecentChatText();
    const rawCharacterText = getActiveCharacterText();
    const chatText = sanitizeForImagePrompt(rawChatText).slice(0, 6000);
    const characterText = sanitizeForImagePrompt(rawCharacterText).slice(0, 3000);
    const presetHints = getPresetVisualHints();
    const visualBrief = makePublicSafeBrief(extractSceneBrief(chatText, characterText));
    const characterBrief = makePublicSafeBrief(getCharacterVisualBrief(`${rawChatText}\n${rawCharacterText}`));

    if (!visualBrief && !characterBrief && !presetHints) {
        throw new Error('当前没有可用于生成的聊天、角色或预设内容');
    }

    return mode === 'character'
        ? buildCharacterPrompt(characterBrief, visualBrief, presetHints)
        : buildScenePrompt(visualBrief, characterBrief, presetHints);
}

function finalCleanImagePrompt(value) {
    return sanitizeForImagePrompt(value)
        .replace(/(?:must not|do not|avoid|forbidden|restricted|policy|safety|安全|禁止|不能|不要)/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
}

function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        }),
    ]);
}

function buildImagePromptInstruction(mode) {
    const task = mode === 'character'
        ? 'Create one English text-to-image prompt for a character portrait.'
        : 'Create one English text-to-image prompt for a story scene illustration.';

    const focus = mode === 'character'
        ? 'Preserve the main character name, age if known, gender, role, hair, face, outfit, personality, and story mood. Use a simple matching background.'
        : 'Preserve the named characters if known, setting, time, atmosphere, outfits, body language, props, and story mood.';

    return [
        task,
        focus,
        'Output only the final image prompt in English. No markdown. No explanations.',
        'Make the prompt complete enough for image generation without seeing the original chat.',
        'When a character card contains role, occupation, hair, face, outfit, personality, or relationship details, keep those visual identity details unless they are private action details.',
        'For character portraits, prioritize the currently active character card over the latest speaker if they differ.',
        'The prompt must be suitable for a public image model: describe only fully dressed fictional adults, neutral body language, environment, lighting, composition, and visual style.',
        'If the source contains private actions or sensitive relationship context, convert them into neutral visual mood such as dramatic tension, emotional intensity, awkward silence, conflict, concern, longing, or suspense.',
        'Keep concrete identity and appearance details. Remove private actions, anatomy details, game mechanics, JSON patches, and meta instructions.',
        'Use positive visual wording only. Do not include refusal or warning instructions.',
        '',
        getPromptSourceText(),
    ].join('\n');
}

async function tryBuildPromptWithAgnesTextAI(mode) {
    if (!settings.apiKey) {
        return '';
    }

    const response = await fetch(AGNES_TEXT_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: AGNES_TEXT_MODEL,
            temperature: 0.4,
            max_tokens: AI_PROMPT_RESPONSE_LENGTH,
            messages: [
                {
                    role: 'system',
                    content: 'You convert roleplay context into safe, concrete, English image prompts. Preserve visual identity and story relevance. Output only the image prompt.',
                },
                {
                    role: 'user',
                    content: buildImagePromptInstruction(mode),
                },
            ],
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
        throw new Error(payload?.error?.message || payload?.message || rawText || response.statusText);
    }

    return finalCleanImagePrompt(payload?.choices?.[0]?.message?.content || '');
}

async function buildPromptWithAgnesTextAI(mode) {
    setStatus('正在调用 Agnes-2.0-Flash 生成完整图片提示词...');
    try {
        const agnesPrompt = await withTimeout(tryBuildPromptWithAgnesTextAI(mode), TEXT_AI_TIMEOUT_MS, 'Agnes text prompt generation');
        if (agnesPrompt) return agnesPrompt;
    } catch (error) {
        console.warn(`[${EXTENSION_TITLE}] Agnes text prompt AI failed, using fallback`, error);
    }

    setStatus('Agnes 文本 AI 失败，正在使用本地降级方式...');
    return buildPrompt(mode);
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
            size: IMAGE_SIZE,
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

function setPanelOpen(isOpen) {
    document.querySelector('#agnes_image_floating_panel')?.classList.toggle('is-open', isOpen);
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
    setPanelOpen(true);
}

async function generateImage(mode) {
    currentMode = mode;

    if (!settings.apiKey) {
        setStatus('请先在扩展设置里填写 Agnes API Key', true);
        setPanelOpen(true);
        return;
    }

    try {
        setPanelOpen(true);
        setStatus(mode === 'character' ? '正在生成角色图...' : '正在生成场景图...');
        const prompt = await buildPromptWithAgnesTextAI(mode);
        const promptBox = document.querySelector('#agnes_image_prompt');
        if (promptBox) promptBox.value = prompt;

        const response = await callAgnesImageApi(prompt);
        const imageUrl = extractImageUrl(response);

        if (!imageUrl) {
            console.warn(`[${EXTENSION_TITLE}] Unexpected Agnes response`, response);
            throw new Error('Agnes 没有返回图片 URL');
        }

        showResult(imageUrl, prompt);
        setStatus(mode === 'character' ? '角色图生成完成' : '场景图生成完成');
    } catch (error) {
        console.error(`[${EXTENSION_TITLE}]`, error);
        setStatus(error.message || String(error), true);
    }
}

function refreshPromptPreview() {
    try {
        const promptBox = document.querySelector('#agnes_image_prompt');
        if (promptBox) promptBox.value = buildPrompt(currentMode);
        setStatus('提示词已按当前聊天和预设刷新');
        setPanelOpen(true);
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
}

function bindFloatingEvents() {
    document.querySelector('#agnes_image_fab')?.addEventListener('click', () => {
        const panel = document.querySelector('#agnes_image_floating_panel');
        setPanelOpen(!panel?.classList.contains('is-open'));
    });

    document.querySelector('#agnes_image_close')?.addEventListener('click', () => setPanelOpen(false));
    document.querySelector('#agnes_image_generate_scene')?.addEventListener('click', () => generateImage('scene'));
    document.querySelector('#agnes_image_generate_character')?.addEventListener('click', () => generateImage('character'));
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
                </div>
            </div>
        </div>
    `;
}

function getFloatingHtml() {
    return `
        <button id="agnes_image_fab" class="agnes-image-fab" type="button" title="Agnes Image">
            <span class="fa-solid fa-image"></span>
        </button>
        <div id="agnes_image_floating_panel" class="agnes-image-floating-panel">
            <div class="agnes-floating-header">
                <b>Agnes Image</b>
                <button id="agnes_image_close" class="menu_button" type="button" title="关闭">×</button>
            </div>
            <div class="agnes-actions">
                <button id="agnes_image_generate_scene" class="menu_button" type="button">生成场景图</button>
                <button id="agnes_image_generate_character" class="menu_button" type="button">生成角色图</button>
                <button id="agnes_image_refresh_prompt" class="menu_button" type="button">预览提示词</button>
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
}

function mountFloatingButton() {
    if (document.querySelector('#agnes_image_fab')) return;

    document.body.insertAdjacentHTML('beforeend', getFloatingHtml());
    bindFloatingEvents();
}

function init() {
    loadSettings();
    const context = getContext();
    const readyEvent = context.eventTypes?.APP_READY || context.event_types?.APP_READY;

    if (context.eventSource && readyEvent) {
        context.eventSource.once(readyEvent, () => {
            mountSettings();
            mountFloatingButton();
        });
    }

    window.setTimeout(() => {
        mountSettings();
        mountFloatingButton();
    }, 1000);

    console.info(`[${EXTENSION_TITLE}] loaded`);
}

init();
