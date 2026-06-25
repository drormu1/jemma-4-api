// מנוע הצ'אטבוט הגנרי - אינו מכיל שום לוגיקה עסקית ספציפית
(function (jq) {
    if (!jq || !jq.fn || jq.fn.on) {
        return;
    }

    // jQuery 1.6.x compatibility: emulate .on() with bind/delegate.
    jq.fn.on = function (events, selector, handler) {
        if (typeof selector === "function") {
            return this.bind(events, selector);
        }
        return this.delegate(selector, events, handler);
    };
})(window.jQuery);

var EnterpriseChatBot = {
    config: null,
    lastPasteSnapshot: null,
    pendingClearAction: null,
    jq: window.jQuery,

    // פונקציית האתחול שמקבלת את הקונפיגורציה הספציפית מהמסך
    init: function (configuration) {
        if (!this.jq) {
            throw new Error("EnterpriseChatBot requires jQuery.");
        }
        this.config = configuration;
        this.loadWidget();
    },

    loadWidget: function () {
        var self = this;
        this.jq.get("/ChatBot/chatbot.html", function (htmlContent) {
            self.jq("body").append(htmlContent);
            self.renderQuickQuestions();
            self.applyUiMode();
            self.initEvents();
        });
    },

    applyUiMode: function () {
        var allowFreeText = this.config.allowFreeText !== false;
        if (!allowFreeText) {
            this.jq('.chat-footer').hide();
            this.jq('#chat-discussion .chat-message.bot').first().text(this.getWelcomeMessage());
        }
    },

    getWelcomeMessage: function () {
        if (this.config.allowFreeText === false) {
            return "שלום! לחץ על אחת השאלות וקבל תשובה כאן.";
        }
        return "שלום! לחץ על אחת השאלות או הקלד שאלה וקבל תשובה כאן.";
    },

    clearChatHistory: function () {
        var shouldConfirm = this.config.confirmClearChat !== false;
        if (shouldConfirm) {
            var self = this;
            this.openClearConfirm(function () {
                self.clearChatHistoryNow();
            });
            return;
        }

        this.clearChatHistoryNow();
    },

    clearChatHistoryNow: function () {
        var chatBody = this.jq('#chat-discussion');
        chatBody.empty();
        chatBody.append(this.jq('<div class="chat-message bot"></div>').text(this.getWelcomeMessage()));
        this.lastPasteSnapshot = null;
    },

    openClearConfirm: function (onConfirm) {
        this.pendingClearAction = typeof onConfirm === "function" ? onConfirm : null;
        this.jq('#chat-clear-confirm-overlay').addClass('open').attr('aria-hidden', 'false');
    },

    closeClearConfirm: function () {
        this.pendingClearAction = null;
        this.jq('#chat-clear-confirm-overlay').removeClass('open').attr('aria-hidden', 'true');
    },

    rememberPasteSnapshot: function (targetId, previousValue) {
        this.lastPasteSnapshot = {
            targetId: targetId,
            previousValue: previousValue
        };
    },

    undoLastPaste: function () {
        if (!this.lastPasteSnapshot || !this.lastPasteSnapshot.targetId) {
            return { ok: false, reason: "אין העתקה" };
        }

        var target = this.jq('#' + this.lastPasteSnapshot.targetId);
        if (!target.length) {
            return { ok: false, reason: "יעד לא נמצא" };
        }

        target.val(this.lastPasteSnapshot.previousValue || "").trigger('change').trigger('input');
        this.lastPasteSnapshot = null;
        return { ok: true };
    },

    // הזרקה דינמית של כפתורי השאלות בהתאם למסך הנוכחי
    renderQuickQuestions: function () {
        var container = this.jq('#chat-quick-questions');
        container.find('.quick-btn').remove(); // ניקוי כפתורים סטטיים אם יש

        var jq = this.jq;
        this.config.questions.forEach(function (q) {
            var btn = jq('<button class="quick-btn"></button>')
                .attr('data-q', q.id)
                .text(q.text);

            if (q.icon) {
                btn.prepend(q.icon); // הזרקת אייקון מותאם במידה ויש
            }
            container.append(btn);
        });
    },

    initEvents: function () {
        var self = this;
        var jq = this.jq;

        jq('#chat-launcher-btn').on('click', function () { jq(this).hide(); jq('#chat-window').css('display', 'flex'); });
        jq('#chat-close-btn').on('click', function () { jq('#chat-window').hide(); jq('#chat-launcher-btn').show(); });

        // האזנה דינמית ללחיצה על שאלות
        jq('#chat-quick-questions').on('click', '.quick-btn', function () {          
            var questionText = jq(this).text().trim();
            var questionId = jq(this).data('q');
            self.processMessage(questionText, questionId);
        });

        if (this.config.allowFreeText !== false) {
            jq('#chat-send-btn').on('click', function () { self.sendFreeMessage(); });
            jq('#chat-user-input').on('keypress', function (e) { if (e.which == 13) self.sendFreeMessage(); });
        }

        jq('#chat-editor-close-x, #chat-editor-close-btn').on('click', function () {
            self.closeAnswerEditor();
        });

        jq('#chat-editor-copy-btn').on('click', function () {
            var button = this;
            var textToCopy = jq('#chat-editor-textarea').val() || "";
            self.copyText(textToCopy, function (ok) {
                self.markActionButton(jq(button), ok ? "הועתק" : "שגיאה", "שגיאה", ok);
            });
        });

        jq('#chat-editor-copy-close-btn').on('click', function () {
            var button = this;
            var textToCopy = jq('#chat-editor-textarea').val() || "";
            self.copyText(textToCopy, function (ok) {
                self.markActionButton(jq(button), ok ? "הועתק" : "שגיאה", "שגיאה", ok);
                if (ok) {
                    self.closeAnswerEditor();
                }
            });
        });

        jq('#chat-editor-modal').on('keydown', function (e) {
            if (e.which === 27) {
                e.preventDefault();
                return false;
            }
        });

        jq('#chat-clear-confirm-cancel').on('click', function () {
            self.closeClearConfirm();
        });

        jq('#chat-clear-confirm-ok').on('click', function () {
            var clearAction = self.pendingClearAction;
            self.closeClearConfirm();
            if (typeof clearAction === "function") {
                clearAction();
            }
        });
    },

    sendFreeMessage: function () {
        var userInput = this.jq('#chat-user-input').val().trim();
        if (!userInput) return;
        this.jq('#chat-user-input').val('');
        this.processMessage(userInput, "free");
    },

    copyText: function (text, onDone) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                onDone(true);
            }).catch(function () {
                onDone(false);
            });
            return;
        }

        var temp = this.jq('<textarea></textarea>').val(text).css({ position: 'fixed', opacity: 0 });
        this.jq('body').append(temp);
        temp.trigger('focus');
        temp.trigger('select');

        try {
            document.execCommand('copy');
            onDone(true);
        } catch (e) {
            onDone(false);
        }

        temp.remove();
    },

    markActionButton: function (button, successText, failText, isSuccess) {
        var originalText = button.text();
        button.text(isSuccess ? successText : failText);
        setTimeout(function () {
            button.text(originalText);
        }, 1300);
    },

    openAnswerEditor: function (answerText) {
        var modal = this.jq('#chat-editor-modal');
        var editor = this.jq('#chat-editor-textarea');
        if (!modal.length || !editor.length) {
            return;
        }

        editor.val(answerText || "");
        modal.addClass('open').attr('aria-hidden', 'false');
        editor.trigger('focus');
    },

    closeAnswerEditor: function () {
        var modal = this.jq('#chat-editor-modal');
        if (!modal.length) {
            return;
        }

        modal.removeClass('open').attr('aria-hidden', 'true');
    },

    appendAnswerActions: function (messageElement, answerText, questionId) {
        var self = this;
        var jq = this.jq;
        var actions = jq('<div class="chat-message-actions"></div>');
        var leftActions = jq('<div class="chat-actions-left"></div>');
        var rightActions = jq('<div class="chat-actions-right"></div>');

        var copyToOpinionBtn = jq('<button type="button" class="chat-action-btn chat-action-btn-soft">העתק לחו"ד</button>');
        var copyToRecommendationBtn = jq('<button type="button" class="chat-action-btn chat-action-btn-soft">העתק להמלצה</button>');
        var copyToBriefBtn = jq('<button type="button" class="chat-action-btn chat-action-btn-soft">העתק לתקציר</button>');
        var copyBtn = jq('<button type="button" class="chat-action-btn chat-action-btn-copy-icon chat-action-btn-icon" title="העתק לזיכרון" aria-label="העתק לזיכרון">⧉</button>');
        var clearBtn = jq('<button type="button" class="chat-action-btn chat-action-btn-clear chat-action-btn-icon chat-action-btn-clear-icon" title="מחיקה" aria-label="מחיקה">🗑</button>');
        var undoBtn = jq('<button type="button" class="chat-action-btn chat-action-btn-undo chat-action-btn-icon" title="בטל העתקה" aria-label="בטל העתקה">↶</button>');
        clearBtn.on('click', function () {
            self.clearChatHistory();
        });
        undoBtn.on('click', function () {
            var button = this;
            var result = self.undoLastPaste();
            self.markActionButton(undoBtn, result.ok ? "↺" : "!", "!", result.ok);
            if (button && button.blur) {
                button.blur();
            }
        });

        copyBtn.on('click', function () {
            var button = this;
            self.copyText(answerText, function (ok) {
                self.markActionButton(copyBtn, ok ? "✓" : "!", "!", ok);
                if (button && button.blur) {
                    button.blur();
                }
            });
        });

        function bindPasteButton(button, targetId) {
            button.on('click', function () {
                var clickedButton = this;
                var target = jq('#' + targetId);
                if (!target.length) {
                    self.markActionButton(button, "הודבק", "יעד לא נמצא", false);
                    if (clickedButton && clickedButton.blur) {
                        clickedButton.blur();
                    }
                    return;
                }

                self.rememberPasteSnapshot(targetId, target.val());
                target.val(answerText).trigger('change').trigger('input');
                self.markActionButton(button, "הודבק", "שגיאה", true);
                if (clickedButton && clickedButton.blur) {
                    clickedButton.blur();
                }
            });
        }

        bindPasteButton(copyToOpinionBtn, "recommendationSummary");
        bindPasteButton(copyToRecommendationBtn, "recommendationConditions");
        bindPasteButton(copyToBriefBtn, "brief");

        leftActions.append(clearBtn, undoBtn, copyBtn);
        rightActions.append(copyToOpinionBtn, copyToRecommendationBtn, copyToBriefBtn);
        actions.append(leftActions, rightActions);
        messageElement.after(actions);

        messageElement.addClass('chat-message-bot-editable');
        var inlineEditBtn = jq('<button type="button" class="chat-inline-edit-btn" title="עריכה במסך גדול" aria-label="עריכה במסך גדול">✎</button>');
        inlineEditBtn.on('click', function () {
            var button = this;
            self.openAnswerEditor(answerText);
            if (button && button.blur) {
                button.blur();
            }
        });
        messageElement.append(inlineEditBtn);
    },

    processMessage: function (text, questionId) {
        var chatBody = this.jq('#chat-discussion');
        chatBody.append('<div class="chat-message user">' + text + '</div>');
        chatBody.scrollTop(chatBody[0].scrollHeight);

        // 1. קבלת קונטקסט מהקובץ העסקי (אם סופק)
        var currentContext = {};
        if (typeof this.config.resolveContext === "function") {
            currentContext = this.config.resolveContext(questionId, text) || {};
        }

        // 2. הצגת אנימציית טעינה
        chatBody.append(
            '<div class="chat-message bot chat-loading-message" id="chat-loading">' +
            '<span class="chat-loading-label">מעבד נתונים</span>' +
            '<span class="chat-loading-dots" aria-hidden="true">' +
            '<span></span><span></span><span></span>' +
            '</span>' +
            '</div>'
        );
        chatBody.scrollTop(chatBody[0].scrollHeight);

        var self = this;

        // 3. הפעלת ה-Handler הספציפי שקיבלנו מהמסך (הפרדה מוחלטת!)
        this.config.onResolveAnswer(questionId, currentContext, function (answer, uiOptions) {
            self.jq('#chat-loading').remove();
            var botMessageElement = self.jq('<div class="chat-message bot"></div>').text(answer);
            chatBody.append(botMessageElement);
            self.appendAnswerActions(botMessageElement, answer, questionId);
            chatBody.scrollTop(chatBody[0].scrollHeight);
        });
    }
};