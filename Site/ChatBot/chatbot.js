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
    lastEditableResultMessage: null,
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
        this.lastEditableResultMessage = null;
        this.updateGlobalActionsState();
        this.updateResendQuestionAvailability();
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
        var self = this;
        this.config.questions.forEach(function (q) {
            var btn = jq('<button class="quick-btn"></button>')
                .attr('data-q', q.id)
                .text(q.text);

            if (q.icon) {
                btn.prepend(
                    jq('<span class="quick-btn-icon" aria-hidden="true"></span>').text(q.icon)
                ); // הזרקת אייקון מותאם במידה ויש
            }

            if (q.id === "resendToAi") {
                btn.prop('disabled', true).attr('aria-disabled', 'true');
            }
            container.append(btn);
        });

        self.updateResendQuestionAvailability();
    },

    getResultsTextBox: function () {
        return this.jq('#resultsTextBox').first();
    },

    getLatestResultEditor: function () {
        if (!this.lastEditableResultMessage || !this.lastEditableResultMessage.length) {
            return this.jq();
        }

        return this.lastEditableResultMessage.find('.chat-message-content-editor').first();
    },

    isLatestResultEditorReadyForResend: function () {
        var latestEditor = this.getLatestResultEditor();
        if (!latestEditor.length || !latestEditor.is(':visible')) {
            return false;
        }

        if (latestEditor.prop('disabled') || latestEditor.prop('readonly')) {
            return false;
        }

        return !!(latestEditor.val() || "").trim();
    },

    syncLatestResultEditorToResultsTextBox: function () {
        var latestEditor = this.getLatestResultEditor();
        var resultsTextBox = this.getResultsTextBox();
        if (!latestEditor.length || !resultsTextBox.length) {
            return;
        }

        if (latestEditor.is(resultsTextBox)) {
            return;
        }

        resultsTextBox.val(latestEditor.val() || "").trigger('change').trigger('input');
    },

    isResultsTextBoxReadyForResend: function () {
        var resultsTextBox = this.getResultsTextBox();
        if (!resultsTextBox.length) {
            return false;
        }

        if (!resultsTextBox.is(':visible')) {
            return false;
        }

        if (resultsTextBox.prop('disabled') || resultsTextBox.prop('readonly')) {
            return false;
        }

        return !!(resultsTextBox.val() || "").trim();
    },

    updateResendQuestionAvailability: function () {
        var resendButton = this.jq('#chat-quick-questions .quick-btn[data-q="resendToAi"]');
        if (!resendButton.length) {
            return;
        }

        var isEnabled = this.isResultsTextBoxReadyForResend() || this.isLatestResultEditorReadyForResend();
        resendButton.prop('disabled', !isEnabled).attr('aria-disabled', isEnabled ? 'false' : 'true');
    },

    setResultsTextBoxFromFirstAnswer: function (answerText, questionId) {
        if (questionId === "resendToAi") {
            return;
        }

        var resultsTextBox = this.getResultsTextBox();
        if (!resultsTextBox.length) {
            return;
        }

        resultsTextBox.val(answerText || "").trigger('change').trigger('input');
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

        jq('#chat-global-clear-btn').on('click', function () {
            self.clearChatHistory();
        });

        jq('#chat-global-undo-btn').on('click', function () {
            var button = jq(this);
            var result = self.undoLastPaste();
            self.markActionButton(button, result.ok ? "↺" : "!", "!", result.ok);
            if (this && this.blur) {
                this.blur();
            }
        });

        jq('#chat-global-copy-btn').on('click', function () {
            var button = jq(this);
            self.copyText(self.getActiveResultText(), function (ok) {
                self.markActionButton(button, ok ? "✓" : "!", "!", ok);
            });
        });

        jq('#chat-global-copy-opinion-btn').on('click', function () {
            self.pasteActiveResultToTarget("recommendationSummary", jq(this));
        });

        jq('#chat-global-copy-recommendation-btn').on('click', function () {
            self.pasteActiveResultToTarget("recommendationConditions", jq(this));
        });

        jq('#chat-global-copy-brief-btn').on('click', function () {
            self.pasteActiveResultToTarget("brief", jq(this));
        });

        jq(document).on('input change', '#resultsTextBox', function () {
            self.updateGlobalActionsState();
            self.updateResendQuestionAvailability();
        });

        jq('#chat-discussion').on('input change', '.chat-message-content-editor', function () {
            self.syncLatestResultEditorToResultsTextBox();
            self.updateGlobalActionsState();
            self.updateResendQuestionAvailability();
        });

        self.updateGlobalActionsState();
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

    setEditorCopyButtonsVisible: function (isVisible) {
        var display = isVisible ? "inline-flex" : "none";
        this.jq('#chat-editor-copy-btn').css('display', display);
        this.jq('#chat-editor-copy-close-btn').css('display', display);
    },

    openAnswerEditor: function (answerText, options) {
        var modal = this.jq('#chat-editor-modal');
        var editor = this.jq('#chat-editor-textarea');
        if (!modal.length || !editor.length) {
            return;
        }

        options = options || {};
        this.setEditorCopyButtonsVisible(options.allowCopy !== false);
        editor.val(answerText || "");
        modal.addClass('open').attr('aria-hidden', 'false');
        editor.trigger('focus');
    },

    syncEditorTextIfOpen: function (answerText) {
        var modal = this.jq('#chat-editor-modal');
        if (!modal.length || !modal.hasClass('open')) {
            return;
        }

        this.jq('#chat-editor-textarea').val(answerText || "");
    },

    ensureInlineEditButton: function (messageElement, getAnswerText, options) {
        var self = this;
        if (!messageElement || !messageElement.length) {
            return;
        }

        var existingButton = messageElement.find('.chat-inline-edit-btn');
        if (existingButton.length) {
            existingButton.remove();
        }
        var existingClearButton = messageElement.find('.chat-inline-clear-btn');
        if (existingClearButton.length) {
            existingClearButton.remove();
        }

        messageElement.addClass('chat-message-bot-editable');
        var inlineEditBtn = this.jq('<button type="button" class="chat-inline-edit-btn" title="עריכה במסך גדול" aria-label="עריכה במסך גדול">✎</button>');
        inlineEditBtn.on('click', function () {
            var button = this;
            var textForEditor = typeof getAnswerText === "function" ? getAnswerText() : "";
            self.openAnswerEditor(textForEditor, options || {});
            if (button && button.blur) {
                button.blur();
            }
        });
        var inlineClearBtn = this.jq('<button type="button" class="chat-inline-clear-btn" title="נקה תשובה" aria-label="נקה תשובה">✕</button>');
        inlineClearBtn.on('click', function () {
            var button = this;
            self.setBotMessageText(messageElement, "");
            if (self.lastEditableResultMessage && self.lastEditableResultMessage.is(messageElement)) {
                self.syncLatestResultEditorToResultsTextBox();
                self.updateGlobalActionsState();
                self.updateResendQuestionAvailability();
            }
            self.markActionButton(inlineClearBtn, "✓", "!", true);
            if (button && button.blur) {
                button.blur();
            }
        });
        messageElement.append(inlineEditBtn);
        messageElement.append(inlineClearBtn);
    },

    isInputLikeElement: function (element) {
        if (!element || !element.length) {
            return false;
        }

        return element.is('input, textarea, select');
    },

    readMessageContentElementValue: function (contentElement) {
        if (!contentElement || !contentElement.length) {
            return "";
        }

        return this.isInputLikeElement(contentElement) ? (contentElement.val() || "") : (contentElement.text() || "");
    },

    ensureMessageContentElement: function (messageElement, preferredType) {
        if (!messageElement || !messageElement.length) {
            return null;
        }

        var contentElement = messageElement.children('.chat-message-content');
        var shouldUseTextArea = preferredType === 'textarea' ? true : (preferredType === 'span' ? false : null);
        if (!contentElement.length) {
            if (shouldUseTextArea === true) {
                contentElement = this.jq('<textarea id="resultsTextBox" class="chat-message-content chat-message-content-editor" rows="8"></textarea>');
            } else {
                contentElement = this.jq('<span class="chat-message-content"></span>');
            }
            messageElement.prepend(contentElement);
        } else {
            var isTextArea = contentElement.is('textarea');
            if (shouldUseTextArea === true && !isTextArea) {
                var spanText = this.readMessageContentElementValue(contentElement);
                contentElement.remove();
                contentElement = this.jq('<textarea id="resultsTextBox" class="chat-message-content chat-message-content-editor" rows="8"></textarea>');
                contentElement.val(spanText);
                messageElement.prepend(contentElement);
            } else if (shouldUseTextArea === false && isTextArea) {
                var textAreaText = this.readMessageContentElementValue(contentElement);
                contentElement.remove();
                contentElement = this.jq('<span class="chat-message-content"></span>');
                contentElement.text(textAreaText);
                messageElement.prepend(contentElement);
            }
        }

        return contentElement;
    },

    markCurrentMessageAsEditableResult: function (messageElement) {
        if (!messageElement || !messageElement.length) {
            return;
        }

        if (this.lastEditableResultMessage && this.lastEditableResultMessage.length) {
            if (!this.lastEditableResultMessage.is(messageElement)) {
                this.ensureMessageContentElement(this.lastEditableResultMessage, 'span');
                this.lastEditableResultMessage.removeClass('chat-message-result-active');
            }
        }

        this.lastEditableResultMessage = messageElement;
        this.lastEditableResultMessage.addClass('chat-message-result-active');
        this.ensureMessageContentElement(this.lastEditableResultMessage, 'textarea');
    },

    setBotMessageText: function (messageElement, text) {
        var contentElement = this.ensureMessageContentElement(messageElement);
        if (!contentElement) {
            return;
        }

        if (this.isInputLikeElement(contentElement)) {
            contentElement.val(text || "");
            return;
        }

        contentElement.text(text || "");
    },

    getBotMessageText: function (messageElement) {
        var contentElement = this.ensureMessageContentElement(messageElement);
        if (!contentElement) {
            return "";
        }

        return this.isInputLikeElement(contentElement) ? (contentElement.val() || "") : (contentElement.text() || "");
    },

    getActiveResultText: function () {
        if (this.lastEditableResultMessage && this.lastEditableResultMessage.length) {
            return this.getBotMessageText(this.lastEditableResultMessage);
        }

        var resultsTextBox = this.getResultsTextBox();
        if (!resultsTextBox.length) {
            return "";
        }

        return resultsTextBox.val() || "";
    },

    getGlobalActionButtons: function () {
        return this.jq(
            '#chat-global-copy-btn,' +
            '#chat-global-copy-opinion-btn,' +
            '#chat-global-copy-recommendation-btn,' +
            '#chat-global-copy-brief-btn'
        );
    },

    updateGlobalActionsState: function () {
        var hasActiveResult = !!(this.getActiveResultText() || "").trim();
        this.getGlobalActionButtons().prop('disabled', !hasActiveResult).attr('aria-disabled', hasActiveResult ? 'false' : 'true');
    },

    clearActiveResultText: function () {
        if (this.lastEditableResultMessage && this.lastEditableResultMessage.length) {
            this.setBotMessageText(this.lastEditableResultMessage, "");
        }

        var resultsTextBox = this.getResultsTextBox();
        if (resultsTextBox.length) {
            resultsTextBox.val("").trigger('change').trigger('input');
        }

        var draftTextBox = this.jq('#resultsTextBoxDraft').first();
        if (draftTextBox.length) {
            draftTextBox.val("").trigger('change').trigger('input');
        }

        this.syncEditorTextIfOpen("");
        this.updateGlobalActionsState();
        this.updateResendQuestionAvailability();
    },

    pasteActiveResultToTarget: function (targetId, button) {
        var target = this.jq('#' + targetId);
        if (!target.length) {
            this.markActionButton(button, "הודבק", "יעד לא נמצא", false);
            return;
        }

        var activeText = this.getActiveResultText();
        if (!activeText || !activeText.trim()) {
            this.markActionButton(button, "הודבק", "אין טקסט", false);
            return;
        }

        this.rememberPasteSnapshot(targetId, target.val());
        target.val(activeText).trigger('change').trigger('input');
        this.markActionButton(button, "הודבק", "שגיאה", true);
    },

    scrollChatToBottom: function (chatBody) {
        if (!chatBody || !chatBody.length || !chatBody[0]) {
            return;
        }
        chatBody.scrollTop(chatBody[0].scrollHeight);
    },

    closeAnswerEditor: function () {
        var modal = this.jq('#chat-editor-modal');
        if (!modal.length) {
            return;
        }

        modal.removeClass('open').attr('aria-hidden', 'true');
    },

    processMessage: function (text, questionId) {
        var chatBody = this.jq('#chat-discussion');
        chatBody.append(this.jq('<div class="chat-message user"></div>').text(text || ""));
        this.scrollChatToBottom(chatBody);

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
        this.scrollChatToBottom(chatBody);

        var self = this;
        var streamingMessageElement = null;
        var loadingRemoved = false;
        function ensureLoadingRemoved() {
            if (loadingRemoved) {
                return;
            }
            self.jq('#chat-loading').remove();
            loadingRemoved = true;
        }

        // 3. הפעלת ה-Handler הספציפי שקיבלנו מהמסך (הפרדה מוחלטת!)
        this.config.onResolveAnswer(questionId, currentContext, function (answer, uiOptions) {
            uiOptions = uiOptions || {};

            if (uiOptions.isPartial === true) {
                ensureLoadingRemoved();
                if (!streamingMessageElement) {
                    streamingMessageElement = self.jq('<div class="chat-message bot"></div>');
                    chatBody.append(streamingMessageElement);
                    self.markCurrentMessageAsEditableResult(streamingMessageElement);
                    self.ensureInlineEditButton(
                        streamingMessageElement,
                        function () { return self.getBotMessageText(streamingMessageElement); },
                        { allowCopy: false }
                    );
                }
                self.setBotMessageText(streamingMessageElement, answer || "");
                self.syncEditorTextIfOpen(answer || "");
                self.updateGlobalActionsState();
                self.scrollChatToBottom(chatBody);
                return;
            }

            ensureLoadingRemoved();

            var botMessageElement = streamingMessageElement;
            if (!botMessageElement) {
                botMessageElement = self.jq('<div class="chat-message bot"></div>');
                chatBody.append(botMessageElement);
            }

            self.markCurrentMessageAsEditableResult(botMessageElement);
            self.setBotMessageText(botMessageElement, answer || "");
            self.syncEditorTextIfOpen(answer || "");
            self.setEditorCopyButtonsVisible(true);
            self.setResultsTextBoxFromFirstAnswer(answer || "", questionId);
            self.updateResendQuestionAvailability();
            self.updateGlobalActionsState();

            self.scrollChatToBottom(chatBody);
        });
    }
};