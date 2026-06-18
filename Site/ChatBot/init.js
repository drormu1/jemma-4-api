window.$ = window.jQuery;


// מימוש ספציפי עבור מסך "תיק לקוח"
$(document).ready(function () {
    var customerChatConfig = window.CustomerChatBotConfig || {};
    var questionsFileUrl = customerChatConfig.questionsFileUrl || "/ChatBot/questions.json";
    var chatApiUrl = customerChatConfig.apiUrl;

    function startChat(customerQuestions) {
        // אתחול המנוע הגנרי עם הלוגיקה העסקית של המסך הנוכחי
        EnterpriseChatBot.init({
            questions: customerQuestions,
            allowFreeText: false,
            destinationTextareaId: "manager-notes",
            resolveContext: function (questionId) {
                return window.ChatContext.resolveClientContextData(customerQuestions, questionId);
            },

            // מה לעשות כשנשאלת שאלה (כאן נמצא ה-Mock הנוכחי, או ה-AJAX העתידי)
            onResolveAnswer: function (questionId, context, callback) {
                window.ChatApi.ask(chatApiUrl, questionId, context, callback);
            }
        });
    }

    $.getJSON(questionsFileUrl)
        .done(function (catalog) {
            startChat((catalog && catalog.questions) || []);
        })
        .fail(function () {
            startChat([]);
        });
});
