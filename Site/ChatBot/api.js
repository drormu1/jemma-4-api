// API transport for chat
window.ChatApi = (function () {
   
    window.__ChatApiVersion= "force-xml-post-v2";

    function getQueryStringParameter(name) {
        if (!window.location || !window.location.search) {
            return null;
        }

        var query = window.location.search.substring(1);
        if (!query) {
            return null;
        }

        var pairs = query.split('&');
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            var key = decodeURIComponent(pair[0] || '');
            if (key !== name) {
                continue;
            }
            return decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
        }
        return null;
    }

    function resolveSubjectId() {
        var rawValue = getQueryStringParameter("DisplaySujects");
        if (rawValue === null || rawValue === "") {
            rawValue = getQueryStringParameter("DisplaySubjects");
        }

        var parsed = parseInt(rawValue, 10);
        return isNaN(parsed) ?window.currentSubjectId : parsed;
    }

    function onSuccess(result, callback) {
        if (result && result.reply) {
            callback(result.reply, { showActions: result.success === true });
            return;
        }
        callback("Empty response from API.", { showActions: false });
    }

    function onError(statusCode, message, callback) {
        callback("API request failed (" + statusCode + "): " + (message || "request failed"), { showActions: false });
    }

    function tryParseJson(text) {
        try {
            return text ? JSON.parse(text) : null;
        } catch (e) {
            return null;
        }
    }

    function postWithXmlHttpRequest(chatApiUrl, payload, callback) {
     
        var xhr = new XMLHttpRequest();
        xhr.open("POST", chatApiUrl, true);
        xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
        xhr.setRequestHeader("Accept", "application/json");
        var lastProcessedLength = 0;
        var streamBuffer = "";
        var hasStreamChunks = false;
        var streamReply = "";

        xhr.onprogress = function () {
            var responseText = xhr.responseText || "";
            if (responseText.length <= lastProcessedLength) {
                return;
            }

            var chunk = responseText.substring(lastProcessedLength);
            lastProcessedLength = responseText.length;
            streamBuffer += chunk;

            var lines = streamBuffer.split(/\r?\n/);
            streamBuffer = lines.pop() || "";

            for (var i = 0; i < lines.length; i++) {
                var line = (lines[i] || "").trim();
                if (!line || line.indexOf("data:") !== 0) {
                    continue;
                }

                var data = line.substring(5).trim();
                if (!data || data === "[DONE]") {
                    continue;
                }

                var parsedChunk = tryParseJson(data);
                if (!parsedChunk) {
                    continue;
                }

                var deltaText =
                    (((parsedChunk.choices || [])[0] || {}).delta || {}).content ||
                    parsedChunk.outputText ||
                    "";

                if (!deltaText) {
                    continue;
                }

                hasStreamChunks = true;
                streamReply += deltaText;
                callback(streamReply, { isPartial: true, showActions: false });
            }
        };

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) {
                return;
            }

            var responseText = xhr.responseText || "";
            var parsed = tryParseJson(responseText);

            if (xhr.status >= 200 && xhr.status < 300) {
                if (hasStreamChunks) {
                    callback(streamReply, { isPartial: false, showActions: true });
                    return;
                }
                onSuccess(parsed, callback);
                return;
            }

            var message = (parsed && parsed.reply) ? parsed.reply : (xhr.statusText || "request failed");
            onError(xhr.status || "unknown", message, callback);
        };

        xhr.send(JSON.stringify(payload));
    }

    function ask(chatApiUrl, questionId, clientContextData, callback) {
        var payload = {
            questionId: questionId,
            clientContextData: clientContextData,
            subjectId: resolveSubjectId()
        };

        // Always use XHR path so we can consume streaming chunks via onprogress.
        postWithXmlHttpRequest(chatApiUrl, payload, callback);
    }

    return {
        ask: ask
    };
})();
