using Mod.CommissionsNG.Web45;
using Mod.CommissionsNG.Web45.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Mvc;
using WebGrease;


namespace Mod.CommissionsNG.Web45.Controllers
{
    public partial class ChatController : Controller
    {
        private static readonly HttpClient HttpClient = new HttpClient();
        private const string PromptTemplateRelativePath = "~/ChatBot/Prompts/system-prompt.md";
        private const string QuestionsCatalogRelativePath = "~/ChatBot/questions.json";
        private const string AiLogFilePath = @"C:\Logs\ai_request_log.txt";
        private Questions _questionsCatalog;

        private string AiApiKey => ConfigurationManager.AppSettings["AiApiKey"];
        private string AiModel => ConfigurationManager.AppSettings["AiModel"];
        private string AiApiUrl => ConfigurationManager.AppSettings["AiApiBaseUrl"];
        private double AiTemperature
        {
            get
            {
                var rawTemperature = ConfigurationManager.AppSettings["AiTemperature"];
                double parsedTemperature;
                if (double.TryParse(rawTemperature, NumberStyles.Float, CultureInfo.InvariantCulture, out parsedTemperature))
                {
                    return parsedTemperature;
                }

                return 0.4;
            }
        }

       

        [HttpPost]
        [ValidateInput(false)]
        public async Task<JsonResult> ChatQuery()
        {
            try
            {
                string requestBody;
                using (var reader = new StreamReader(Request.InputStream))
                {
                    Request.InputStream.Position = 0;
                    requestBody = reader.ReadToEnd();
                }
                var questionInput = DeserializeClientRequest(requestBody);
                if (questionInput == null)
                {
                    return Json(new ChatResponse { success = false, reply = "Invalid JSON payload." });
                }

                questionInput.QuestionId = (questionInput.QuestionId ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(questionInput.QuestionId))
                {
                    return Json(new ChatResponse { success = false, reply = "Question id is required." });
                }

                questionInput.ClientContextData = questionInput.ClientContextData == null || questionInput.ClientContextData.Count == 0
                    ? null
                    : questionInput.ClientContextData;

                var questionConfig = FindQuestionConfig(questionInput.QuestionId);
                var queryExt = GetQuestionExtensionText(questionInput.QuestionId);
                var userPrompt = GetUserPrompt(questionInput);
                var isOpenQuestion = questionConfig?.IsOpenQuestion ?? false;

                if (string.IsNullOrWhiteSpace(userPrompt) && !isOpenQuestion)
                {
                    return Json(new ChatResponse
                    {
                        success = false,
                        reply = "לא ניתן לבצע את הבקשה שביקשת עקב נכונות הנתונים שהעברת"
                    });
                }

                string chatRequestPayload = BuildChatRequestPayload(userPrompt, queryExt);
                ChatResponse chatResponse = await SendToAiAsync(chatRequestPayload);
                return Json(chatResponse);
            }
            catch (Exception ex)
            {
                return Json(new ChatResponse { success = false, reply = $"Internal server error: {ex.Message}" });
            }
        }

        private ClientRequest DeserializeClientRequest(string requestBody)
        {
            try
            {
                return JsonConvert.DeserializeObject<ClientRequest>(requestBody);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private string BuildChatRequestPayload(string userPrompt, string queryExt)
        {
            string systemPrompt = GetSystemPrompt();
            var finalUserPrompt = userPrompt;

            if (!string.IsNullOrWhiteSpace(userPrompt) && !string.IsNullOrWhiteSpace(queryExt))
            {
                finalUserPrompt = queryExt + Environment.NewLine + Environment.NewLine + userPrompt;
            }

            var aiPayload = new
            {
                model = AiModel,             
                temperature = AiTemperature,
                stream = false,
                messages = new[] {
                                   new {
                                            type = "message",
                                            role = "system",
                                            content = new[] {
                                                new {
                                                    type = "text",
                                                    text = systemPrompt
                                                }
                                            }
                                   },
                                   new {
                                            type = "message",
                                            role = "user",
                                            content =  new[] {
                                                new {
                                                    type = "text",
                                                    text = finalUserPrompt
                                                }
                                            }
                                    }
                                   }

            };

            var jsonPayload = JsonConvert.SerializeObject(aiPayload);
            WriteAiLog(finalUserPrompt, jsonPayload);

            return jsonPayload;
        }

        private int GenerateLineId()
        {
            var bytes = Guid.NewGuid().ToByteArray();
            var value = BitConverter.ToInt32(bytes, 0);
            return Math.Abs(value == int.MinValue ? 0 : value);
        }

        private string GetUserPrompt(ClientRequest queryInput)
        {
            var dataFromLogic = GetDataFromLogic(queryInput.QuestionId);
            var dataFromClient = GetDataFromClient(queryInput.ClientContextData);
            var formattedLogicContext = FormatLogicContextForPrompt(dataFromLogic);

            var promptParts = new[]
            {              
                formattedLogicContext,
                dataFromClient
            };
            return string.Join(Environment.NewLine + Environment.NewLine, 
            promptParts.Where(part => !string.IsNullOrWhiteSpace(part)));

        }

        private string FormatLogicContextForPrompt(object logicContext)
        {
            if (logicContext == null)
            {
                return string.Empty;
            }

            var json = JsonConvert.SerializeObject(logicContext, Formatting.Indented);
            if (string.IsNullOrWhiteSpace(json) || json == "{}")
            {
                return string.Empty;
            }

            return "להלן מבנה הנתונים שהגיע מבסיס הנתונים העסקי, תסתמך עליו בתשובתך :" 
                + Environment.NewLine
                + json;
        }

        private string GetDataFromClient(Dictionary<string, string> clientContextData)
        {
            var sb = new StringBuilder();
            if (clientContextData == null || clientContextData.Count == 0)
            {
                return string.Empty;
            }

            foreach (var item in clientContextData)
            {
                var rawKey = item.Key;
                if (string.IsNullOrWhiteSpace(rawKey))
                {
                    continue;
                }

                var normalizedKey = rawKey.Trim().TrimStart('#');
                if (string.IsNullOrWhiteSpace(normalizedKey))
                {
                    continue;
                }

                var rawValue = item.Value;

                if (string.IsNullOrWhiteSpace(rawValue))
                {
                    continue;
                }

                var withoutTags = Regex.Replace(rawValue, "<[^>]+>", " ");
                var decodedValue = WebUtility.HtmlDecode(withoutTags);
                var normalizedValue = Regex.Replace(decodedValue ?? string.Empty, "\\s+", " ").Trim();

                if (string.IsNullOrWhiteSpace(normalizedValue))
                {
                    continue;
                }

                sb.AppendLine("- " + normalizedKey + ": " + normalizedValue);
            }

            return sb.ToString().TrimEnd();
        }

        private async Task<ChatResponse> SendToAiAsync(string chatRequestPayload)
        {

            var response = await SendWithRetryAsync(AiApiUrl, chatRequestPayload);
            var responseString = await response.Content.ReadAsStringAsync();
            WriteAiResponseLog(response.StatusCode, responseString);

            if (!response.IsSuccessStatusCode)
            {
                return new ChatResponse { success = false, reply = $"AI provider API error (status: {(int)response.StatusCode})" };
            }

            var aiResult = JObject.Parse(responseString);
            var botReply = ExtractReplyFromCurrentProvider(aiResult);
            

            if (string.IsNullOrWhiteSpace(botReply))
            {
                return new ChatResponse { success = false, reply = "Received an empty response from AI provider." };
            }

            return new ChatResponse { success = true, reply = botReply };
        }

        private string ExtractReplyFromCurrentProvider(JObject aiResult)
        {
            
            if (!string.IsNullOrWhiteSpace(aiResult["outputText"]?.ToString()))
            {
                return aiResult["outputText"]?.ToString();
            }
            else 
            {
                return "לא ניתן לחלץ את המחרוזת משירות ה AI ";
            }

                
        }

        private async Task<HttpResponseMessage> SendWithRetryAsync(string url, string jsonPayload)
        {
            const int maxRetries = 2;
            const int retryDelayMs = 900;
            var bearerToken = ReadBearerToken();

            HttpResponseMessage response = null;
            var totalAttempts = maxRetries + 1;

            for (var attempt = 1; attempt <= totalAttempts; attempt++)
            {
                using (var request = new HttpRequestMessage(HttpMethod.Post, url))
                {
                    request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                    if (!string.IsNullOrWhiteSpace(bearerToken))
                    {
                        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
                    }

                    response = await HttpClient.SendAsync(request);
                }

                var shouldRetry = response.StatusCode == HttpStatusCode.ServiceUnavailable || (int)response.StatusCode == 429;
                if (!shouldRetry || attempt == totalAttempts)
                {
                    return response;
                }

                await Task.Delay(retryDelayMs * attempt);
            }

            return response;
        }

        private string ReadBearerToken()
        {
            const string bearerTokenFilePath = @"C:\temp\bearer.txt";

            try
            {
                if (!System.IO.File.Exists(bearerTokenFilePath))
                {
                    return null;
                }

                var token = System.IO.File.ReadAllText(bearerTokenFilePath, Encoding.UTF8);
                return string.IsNullOrWhiteSpace(token) ? null : token.Trim();
            }
            catch
            {
                return null;
            }
        }

// Context enrichment
        private bool IsServerSideEnrichmentQuestion(string questionId)
        {
            return IsServerContextFromLogicEnabled(questionId);
        }

        private object GetDataFromLogic(string questionId)
        {
            if (!IsServerContextFromLogicEnabled(questionId))
            {
                return null;
            }

            switch (questionId)
            {
                case "opionionsSummary":
                    return GetOpinionsSumamry();
                case "validateTotRecommandation":
                    return GetValidateTotRecommandationServerContext();
                case "createRecommantionTemplate":
                    return CreateRecommentionTemplate();
                case "getHistory":
                    return GetHistoryServerContext();
                default:
                    return null;
            }
        }

     

     
      

        private string GetSystemPrompt()
        {
            return System.IO.File.ReadAllText(Server.MapPath(PromptTemplateRelativePath), Encoding.UTF8);
        }


        private string GetQuestionExtensionText(string questionId)
        {
            var questionConfig = FindQuestionConfig(questionId);
            return questionConfig?.QuestionExtended;
        }

        private bool IsServerContextFromLogicEnabled(string questionId)
        {
            var questionConfig = FindQuestionConfig(questionId);
            return questionConfig != null && questionConfig.ServerContextFromLogic;
        }

        private Question FindQuestionConfig(string questionId)
        {
            return LoadQuestionsCatalog().Items
                .FirstOrDefault(q => string.Equals(q.Id, questionId, StringComparison.OrdinalIgnoreCase));
        }

        private Questions LoadQuestionsCatalog()
        {
            return _questionsCatalog ?? (_questionsCatalog = JsonConvert.DeserializeObject<Questions>(System.IO.File.ReadAllText(Server.MapPath(QuestionsCatalogRelativePath), Encoding.UTF8)));
        }

     

      

        #region logic context

        private object GetOpinionsSumamry()
        {
            return new[]
            {
                new { lineId = 482731, materialName = "אלומיניום", countryName = "ישראל", expertName = "דני כהן", role = "מומחה רגולציה", opinionText = "ניתן לאשר בכפוף להשלמת מסמך תאימות מעודכן." },
                new { lineId = 905214, materialName = "פלדה", countryName = "ארצות הברית", expertName = "מיכל לוי", role = "יועצת יצוא", opinionText = "אין מניעה מהותית, אך נדרש בירור נוסף לגבי משתמש קצה." },
                new { lineId = 317640, materialName = "זכוכית", countryName = "גרמניה", expertName = "יואב פרץ", role = "אנליסט סיכונים", opinionText = "הסיכון נמוך, מומלץ לאשר בתנאים הקיימים." },
                new { lineId = 764128, materialName = "סיליקון", countryName = "יפן", expertName = "רותם דיין", role = "מומחית טכנולוגית", opinionText = "נדרשת הבהרה טכנית לגבי מפרט המוצר לפני החלטה." },
                new { lineId = 128573, materialName = "נחושת", countryName = "קנדה", expertName = "אלון ברק", role = "בודק מסמכים", opinionText = "המסמכים תקינים, ניתן להתקדם לאישור." },
                new { lineId = 659302, materialName = "קרמיקה", countryName = "הולנד", expertName = "יעל שחר", role = "יועצת מסחר", opinionText = "מומלץ לצרף התחייבות חוזית לשימוש אזרחי בלבד." },
                new { lineId = 440917, materialName = "גרניט", countryName = "ספרד", expertName = "אורן סגל", role = "מבקר איכות", opinionText = "אין חריגה באיכות, אך חסר אישור מקור עדכני." },
                new { lineId = 993085, materialName = "טקסטיל", countryName = "סין", expertName = "הילה נאור", role = "מומחית שרשרת אספקה", opinionText = "ניתן לאשר בכפוף לעמידה בדרישות סימון ואריזה." },
                new { lineId = 276451, materialName = "אבץ", countryName = "הודו", expertName = "גיל רוזן", role = "אנליסט ציות", opinionText = "נדרש מסמך ציות נוסף לפני אישור סופי." },
                new { lineId = 851664, materialName = "זהב", countryName = "שווייץ", expertName = "נועה אמיר", role = "יועצת משפטית", opinionText = "ניתן לאשר רק לאחר השלמת בדיקת רקע לספק." }
            };
        }

        private object GetValidateTotRecommandationServerContext()
        {
            // TODO: Replace with real DB/service fetch for validateTotRecommandation question.
            return new
            {
                requiresValidation = true,
                validationSource = "server-logic",
                items = new object[0]
            };
        }

        private object CreateRecommentionTemplate()
        {
            // TODO: Replace with real DB/service fetch for tickets-summary question.
            return new[]
            {
                new { lineId = GenerateLineId(), countryName = "ישראל", materialName = "אלומיניום", customerName = "אלקטרה בע\"מ" },
                new { lineId = GenerateLineId(), countryName = "ארצות הברית", materialName = "פלדה", customerName = "טכנולוגיות מתקדמות" },
                new { lineId = GenerateLineId(), countryName = "גרמניה", materialName = "זכוכית", customerName = "אורן תעשיות" },
                new { lineId = GenerateLineId(), countryName = "איטליה", materialName = "שיש", customerName = "עיצובי האבן" },
                new { lineId = GenerateLineId(), countryName = "יפן", materialName = "סיליקון", customerName = "שבבי העתיד" },
                new { lineId = GenerateLineId(), countryName = "צרפת", materialName = "עץ אלון", customerName = "רהיטי איכות" },
                new { lineId = GenerateLineId(), countryName = "קנדה", materialName = "נחושת", customerName = "תשתיות אנרגיה" },
                new { lineId = GenerateLineId(), countryName = "בריטניה", materialName = "בטון", customerName = "בונים בטוח" },
                new { lineId = GenerateLineId(), countryName = "אוסטרליה", materialName = "ברזל", customerName = "מתכות הנגב" },
                new { lineId = GenerateLineId(), countryName = "ברזיל", materialName = "גומי", customerName = "גלגלי הצפון" },
                new { lineId = GenerateLineId(), countryName = "דרום קוריאה", materialName = "פולימרים", customerName = "פלאסט-טק" },
                new { lineId = GenerateLineId(), countryName = "הולנד", materialName = "קרמיקה", customerName = "כלים נאים" },
                new { lineId = GenerateLineId(), countryName = "ספרד", materialName = "גרניט", customerName = "שיש המרכז" },
                new { lineId = GenerateLineId(), countryName = "יוון", materialName = "סיד", customerName = "חומרי בניין בע\"מ" },
                new { lineId = GenerateLineId(), countryName = "שוודיה", materialName = "נייר", customerName = "דפוס שלום" },
                new { lineId = GenerateLineId(), countryName = "סין", materialName = "טקסטיל", customerName = "אופנת הארץ" },
                new { lineId = GenerateLineId(), countryName = "הודו", materialName = "אבץ", customerName = "ציפוי מתכות" },
                new { lineId = GenerateLineId(), countryName = "טורקיה", materialName = "גבס", customerName = "קירות ירוקים" },
                new { lineId = GenerateLineId(), countryName = "מקסיקו", materialName = "פחמן", customerName = "סיבי העל" },
                new { lineId = GenerateLineId(), countryName = "שווייץ", materialName = "זהב", customerName = "תכשיטי היוקרה" }
            };
        }

        private object GetHistoryServerContext()
        {
            // TODO: Replace with real DB/service fetch for getHistory question.
            return new
            {
                source = "history",
                entries = new object[0]
            };
        }

        #endregion
        private void WriteAiLog(string finalPrompt, string jsonPayload)
        {
            try
            {
                var logBuilder = new StringBuilder();
                logBuilder.AppendLine("===== AI REQUEST =====");
                logBuilder.AppendLine("Timestamp: " + DateTime.UtcNow.ToString("o"));
                logBuilder.AppendLine("Endpoint: " + AiApiUrl);
                
                logBuilder.AppendLine("Payload:");
                logBuilder.AppendLine(jsonPayload);
                logBuilder.AppendLine();
                System.IO.File.AppendAllText(AiLogFilePath, logBuilder.ToString(), Encoding.UTF8);
            }
            catch (Exception e)
            {
               // Log.Error(e);
                // Logging should never break chat flow.
            }
        }

        private void WriteAiResponseLog(HttpStatusCode statusCode, string responseBody)
        {
            try
            {
                var logBuilder = new StringBuilder();
                logBuilder.AppendLine("===== AI RESPONSE =====");
                logBuilder.AppendLine("Timestamp: " + DateTime.UtcNow.ToString("o"));
                logBuilder.AppendLine("Endpoint: " + AiApiUrl);
                logBuilder.AppendLine("StatusCode: " + (int)statusCode + " (" + statusCode + ")");
                logBuilder.AppendLine("Body:");
                logBuilder.AppendLine(responseBody ?? string.Empty);
                logBuilder.AppendLine();

                System.IO.File.AppendAllText(AiLogFilePath, logBuilder.ToString(), Encoding.UTF8);
            }
            catch
            {
                // Logging should never break chat flow.
            }
        }

    }
}
