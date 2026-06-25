(function (doc) {
    var scriptPaths = [
        "/ChatBot/chatbot.js",
        "/ChatBot/questions.js",
        "/ChatBot/context.js",
        "/ChatBot/api.js",
        "/ChatBot/init.js"
    ];

    for (var i = 0; i < scriptPaths.length; i++) {
        var script = doc.createElement("script");
        script.src = scriptPaths[i];
        script.async = false;
        (doc.head || doc.body || doc.documentElement).appendChild(script);
    }
})(document);
