console.log("==================================================");
console.log("🚨🚨🚨 FateX Engram Custom 스크립트 로딩 성공! 🚨🚨🚨");
console.log("==================================================");

Hooks.once('ready', async function () {

    // ====================================================================
    // ⭐ 엔진 개조 1: 토큰 바가 system 데이터 대신 flags(커스텀 데이터)를 읽도록 교육합니다.
    // ====================================================================
    const originalGetBarAttribute = TokenDocument.prototype.getBarAttribute;
    TokenDocument.prototype.getBarAttribute = function (barName, options) {
        const attr = options?.alternative || this[barName]?.attribute;

        // 우리가 만든 Engram Custom 데이터(flags)를 찾도록 요청받았다면?
        if (attr && attr.startsWith("flags.fatex-engram-custom.") && this.actor) {
            const flagData = foundry.utils.getProperty(this.actor, attr) || {};
            let value = Number(flagData.value) || 0;
            let max = Number(flagData.max) || 0;

            // ⭐ 핵심 수정: MP의 경우, DB의 max값이 비어있거나 꼬였을 수 있으므로 여기서 실시간으로 완벽하게 계산해버립니다!
            if (attr === "flags.fatex-engram-custom.mp") {
                let extractedCount = 0;
                this.actor.items.filter(i => i.type === "aspect").forEach(a => {
                    if (a.getFlag("fatex-engram-custom", "extracted")) extractedCount++;
                });
                max = 100 - (extractedCount * 20); // 100, 80, 60 등 정확한 최대치 보장
            }

            // 혹시 HP 최대치도 0으로 꼬여있다면 기본값 10으로 방어합니다.
            if (attr === "flags.fatex-engram-custom.hp" && max === 0) {
                max = 10;
            }

            return {
                type: "bar",
                attribute: attr,
                value: value,
                max: max
            };
        }
        // 그 외의 시스템 기본 체력 등은 파운드리의 원래 기능을 그대로 통과시킵니다.
        return originalGetBarAttribute.call(this, barName, options);
    };

    // ====================================================================
    // ⭐ 엔진 개조 2: 맵 화면에서 토큰 바를 우클릭해 숫자를 깎을 때 시트(DB)와 양방향 연동되게 만듭니다.
    // ====================================================================
    const originalModifyTokenAttribute = Actor.prototype.modifyTokenAttribute;
    Actor.prototype.modifyTokenAttribute = async function (attribute, value, isDelta, isBar) {
        if (attribute && attribute.startsWith("flags.fatex-engram-custom.")) {
            const current = foundry.utils.getProperty(this, attribute);
            if (!current) return this;
            let newValue = isDelta ? current.value + value : value;
            newValue = Math.max(0, Math.min(newValue, current.max)); // 0 이하로 떨어지거나 최대치를 넘지 않도록 방어
            return this.update({ [`${attribute}.value`]: newValue });
        }
        return originalModifyTokenAttribute.call(this, attribute, value, isDelta, isBar);
    };


    const fatexSheets = CONFIG.Actor.sheetClasses.character;
    const BaseFateXSheet = fatexSheets["FateX.CharacterSheet"]?.cls;

    if (!BaseFateXSheet) return;

    class EngramFateXSheet extends BaseFateXSheet {
        static get defaultOptions() {
            return mergeObject(super.defaultOptions, {
                classes: ["fatex", "engram-custom-sheet"]
            });
        }

        get template() {
            return "modules/fatex-engram-custom/templates/custom-sheet.hbs";
        }

        // --- 1. MP 최대치 계산 로직 ---
        async getData(options) {
            const context = await super.getData(options);
            const flags = this.actor.flags["fatex-engram-custom"] || {};

            let extractedCount = 0;
            const aspects = this.actor.items.filter(i => i.type === "aspect");
            for (let aspect of aspects) {
                if (aspect.getFlag("fatex-engram-custom", "extracted")) {
                    extractedCount++;
                }
            }

            const maxMp = 100 - (extractedCount * 20);

            context.customData = {
                hp: { value: flags.hp?.value ?? 10, max: flags.hp?.max ?? 10 },
                mp: { value: flags.mp?.value ?? maxMp, max: maxMp }
            };

            return context;
        }

        // --- 2. 이벤트 리스너 및 초기화 ---
        activateListeners(html) {
            super.activateListeners(html);

            // [초기화 셋업] 캐릭터 생성 직후 DB가 비어있으면 토큰 바가 나오지 않으므로 기본값을 즉시 주입
            const flags = this.actor.flags["fatex-engram-custom"] || {};
            if (flags.hp === undefined || flags.mp === undefined) {
                let extractedCount = 0;
                this.actor.items.filter(i => i.type === "aspect").forEach(aspect => {
                    if (aspect.getFlag("fatex-engram-custom", "extracted")) extractedCount++;
                });
                const maxMp = 100 - (extractedCount * 20);

                this.actor.update({
                    "flags.fatex-engram-custom.hp": flags.hp || { value: 10, max: 10 },
                    "flags.fatex-engram-custom.mp": flags.mp || { value: maxMp, max: maxMp }
                });
            }

            // [면모 적출 체크박스 클릭 연동]
            html.find('.engram-memory-extract').on('change', async (e) => {
                const itemId = $(e.currentTarget).data('item-id');
                const isChecked = $(e.currentTarget).is(':checked');
                const item = this.actor.items.get(itemId);

                if (item) {
                    await item.setFlag("fatex-engram-custom", "extracted", isChecked);

                    let extractedCount = 0;
                    const aspects = this.actor.items.filter(i => i.type === "aspect");

                    for (let aspect of aspects) {
                        if (aspect.id === itemId) {
                            if (isChecked) extractedCount++;
                        } else {
                            if (aspect.getFlag("fatex-engram-custom", "extracted")) extractedCount++;
                        }
                    }

                    const maxMp = 100 - (extractedCount * 20);
                    let currentMp = this.actor.getFlag("fatex-engram-custom", "mp")?.value ?? maxMp;
                    currentMp = Math.min(currentMp, maxMp);

                    await this.actor.update({
                        "flags.fatex-engram-custom.mp": { value: currentMp, max: maxMp }
                    });
                }
            });

            // [3. 면모 전용 말풍선(채팅) 버튼 가로채기]
            html.find('.fatex-desk__aspects .fatex-js-item-to-chat').off('click').on('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const itemId = $(e.currentTarget).data('item');
                const item = this.actor.items.get(itemId);

                if (item) {
                    const content = item.system.value || "";
                    const enriched = await TextEditor.enrichHTML(content, { async: true });

                    const templateData = {
                        item: {
                            name: item.system.label || item.name,
                            img: item.img,
                            system: { enrichedDescription: enriched }
                        }
                    };

                    const chatHtml = await renderTemplate("systems/fatex/templates/chat/item-card.hbs", templateData);

                    await ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                        content: chatHtml
                    });
                }
            });
        }
    }

    // --- 4. 토큰 설정 창(Token Config) 가로채기: HP/MP 속성 추가 ---
    Hooks.on("renderTokenConfig", (app, html, data) => {
        const $html = $(html);
        const bar1Select = $html.find('select[name="bar1.attribute"]');
        const bar2Select = $html.find('select[name="bar2.attribute"]');

        const customOptions = `
        <optgroup label="Engram Custom (특수)">
            <option value="flags.fatex-engram-custom.hp">HP</option>
            <option value="flags.fatex-engram-custom.mp">MP</option>
        </optgroup>
        `;

        bar1Select.append(customOptions);
        bar2Select.append(customOptions);

        const tokenDoc = app.token || app.document || data.object;
        if (tokenDoc) {
            bar1Select.val(tokenDoc.bar1?.attribute);
            bar2Select.val(tokenDoc.bar2?.attribute);
        }
    });

    Actors.registerSheet("fatex", EngramFateXSheet, {
        types: ["character"],
        makeDefault: true,
        label: "Engram Custom FateX Sheet"
    });
});