console.log("==================================================");
console.log("🚨🚨🚨 FateX Engram Custom 스크립트 로딩 성공! 🚨🚨🚨");
console.log("==================================================");

Hooks.once('ready', async function () {
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
            // 액터가 가진 아이템 중 '면모(aspect)'만 골라냅니다.
            const aspects = this.actor.items.filter(i => i.type === "aspect");
            for (let aspect of aspects) {
                // 해당 면모에 'extracted(적출됨)' 플래그가 켜져 있는지 확인합니다.
                if (aspect.getFlag("fatex-engram-custom", "extracted")) {
                    extractedCount++;
                }
            }

            // 적출된 기억 1개당 최대 MP 20 감소 (기본 100)
            const maxMp = 100 - (extractedCount * 20);

            context.customData = {
                hp: { value: flags.hp?.value ?? 10, max: flags.hp?.max ?? 10 },
                mp: { value: flags.mp?.value ?? maxMp, max: maxMp }
            };

            return context;
        }

        // --- 2. 면모 적출 이벤트 리스너 (DOM 조작 불필요!) ---
        activateListeners(html) {
            super.activateListeners(html);

            // 체크박스 클릭 시 데이터 저장 (저장 즉시 시트가 자동으로 리렌더링되며 MP 감소 & 취소선 적용됨)
            html.find('.engram-memory-extract').on('change', async (e) => {
                const itemId = $(e.currentTarget).data('item-id');
                const isChecked = $(e.currentTarget).is(':checked');
                const item = this.actor.items.get(itemId);

                if (item) {
                    await item.setFlag("fatex-engram-custom", "extracted", isChecked);
                }
            });

            // --- 3. 면모 전용 말풍선(채팅) 버튼 가로채기 ---
            // FateX 기본 시스템이 item.name을 고집하는 것을 막고, item.system.label을 제목으로 쓰도록 강제합니다.
            html.find('.fatex-desk__aspects .fatex-js-item-to-chat').off('click').on('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const itemId = $(e.currentTarget).data('item');
                const item = this.actor.items.get(itemId);

                if (item) {
                    // 면모의 실제 텍스트 내용 가져오기
                    const content = item.system.value || "";
                    const enriched = await TextEditor.enrichHTML(content, { async: true });

                    // ⭐ 핵심: 템플릿에 데이터를 넘길 때, name 자리에 item.system.label을 덮어씌워서 속입니다!
                    const templateData = {
                        item: {
                            name: item.system.label || item.name, // 라벨이 비어있으면 기본 이름 사용
                            img: item.img,
                            system: { enrichedDescription: enriched }
                        }
                    };

                    // FateX의 채팅 카드 디자인(item-card.hbs)을 그대로 빌려와서 화면을 그립니다.
                    const chatHtml = await renderTemplate("systems/fatex/templates/chat/item-card.hbs", templateData);

                    // 채팅창에 전송!
                    await ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                        content: chatHtml
                    });
                }
            });
        }
    }

    Actors.registerSheet("fatex", EngramFateXSheet, {
        types: ["character"],
        makeDefault: true,
        label: "Engram Custom FateX Sheet"
    });
});