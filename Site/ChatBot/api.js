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

    function postWithXmlHttpRequest(chatApiUrl, payload, callback) {
     
        var xhr = new XMLHttpRequest();
        xhr.open("POST", chatApiUrl, true);
        xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
        xhr.setRequestHeader("Accept", "application/json");

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) {
                return;
            }

            var responseText = xhr.responseText || "";
            var parsed = null;
            try {
                parsed = responseText ? JSON.parse(responseText) : null;
            } catch (e) {
                parsed = null;
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                onSuccess(parsed, callback);
                return;
            }

            var message = (parsed && parsed.reply) ? parsed.reply : (xhr.statusText || "request failed");
            onError(xhr.status || "unknown", message, callback);
        };

        xhr.send(JSON.stringify(payload));
    }

    function ask(chatApiUrl, questionId, clientContextData, callback) {
      
        console.log('resolveSubjectId = ' +resolveSubjectId());
        var payload = {
            questionId: questionId,
            clientContextData: clientContextData,
            subjectId: resolveSubjectId()
        };

        var jq = window.jQuery;
        if (!jq || !jq.ajax) {
            postWithXmlHttpRequest(chatApiUrl, payload, callback);
            return;
        }

        jq.ajax({
            url: chatApiUrl,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            data: JSON.stringify(payload),
            success: function (result) {
                onSuccess(result, callback);
            },
            error: function (xhr, status, errorThrown) {
                var statusCode = xhr && xhr.status ? xhr.status : "unknown";
                var message = errorThrown || status || "request failed";
                onError(statusCode, message, callback);
            }
        });
    }

    return {
        ask: ask
    };
})();
