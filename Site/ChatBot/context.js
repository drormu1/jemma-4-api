// Context extraction for the current screen
window.ChatContext = (function () {
    function getQuestionConfig(questions, questionId) {
        for (var i = 0; i < questions.length; i++) {
            if (questions[i].id === questionId) {
                return questions[i];
            }
        }
        return null;
    }

    function readElementText(element) {
        if (!element || !element.length) {
            return "";
        }
        return element.is('input, textarea, select') ? element.val().trim() : element.text().trim();
    }

    function normalizeSelector(selectorOrId) {
        if (!selectorOrId || typeof selectorOrId !== "string") {
            return null;
        }
        return selectorOrId.charAt(0) === "#" ? selectorOrId : ("#" + selectorOrId);
    }

    function toPayloadKey(selector) {
        if (!selector) {
            return null;
        }
        return selector.charAt(0) === "#" ? selector.substring(1) : selector;
    }

    function resolveClientContextData(questions, questionId) {
        var questionConfig = getQuestionConfig(questions, questionId);
        var selectors = questionConfig && questionConfig.clientContextSelectors;
        if (!selectors || !selectors.length) {
            return {};
        }

        var contextData = {};
        for (var i = 0; i < selectors.length; i++) {
            var normalizedSelector = normalizeSelector(selectors[i]);
            var payloadKey = toPayloadKey(normalizedSelector);
            if (!normalizedSelector || !payloadKey) {
                continue;
            }

            var elementValue = readElementText($(normalizedSelector).first());
            if (!elementValue) {
                continue;
            }

            contextData[payloadKey] = elementValue;
        }

        return contextData;
    }

    return {
        resolveClientContextData: resolveClientContextData
    };
})();
