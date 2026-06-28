using Site.ChatBot.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Site.Logic;
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Mvc;

namespace Site.Controllers
{
    public class ChatbotController : Controller
    {
        private readonly IChatbotLogic _chatbotLogic;
        // logger disabled per request
        private static readonly HttpClient _httpClient = new HttpClient();

        public ChatbotController()
            : this(new ChatbotLogic())
        {
        }

        public ChatbotController(IChatbotLogic chatbotLogic)
        {
            _chatbotLogic = chatbotLogic ?? new ChatbotLogic();
        }

        private const string PromptTemplateRelativePath = "~/ChatBot/Prompts";
        private const string QuestionsCatalogRelativePath = "~/ChatBot/questions.json";
        private const string AiLogFilePath = @"C:\Logs\ai.log";
        private Questions _questionsCatalog;

        private string AiModel => ConfigurationManager.AppSettings["AiModel"];
        private string AiApiUrl => ConfigurationManager.AppSettings["AiApiUrl"];


        [HttpPost]
        [ValidateInput(false)]
        public async Task<ActionResult> ChatQuery()
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

                // Per-question stream switch from questions.json; defaults to false when omitted.
                bool streamEnabled = questionConfig?.Stream ?? false;
                string chatRequestPayload = BuildChatRequestPayload(userPrompt, questionConfig);
                if (streamEnabled)
                {
                    return await StreamToClientAsync(chatRequestPayload);
                }

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


        private string BuildChatRequestPayload(string userPrompt, Question questionConfig)
        {
            string systemPrompt = GetSystemPrompt();
            // Build request stream mode strictly from question configuration.
            bool streamEnabled = questionConfig?.Stream ?? false;

            var aiPayload = new
            {
                model = AiModel,
                n = 1,
                temperature = AiTemperature,
                stream = streamEnabled,
                messages = new[] {
                                   new {
                                            role = "system",
                                             content = systemPrompt
                                   },

                                  new  {
                                            role = "user",
                                             content = userPrompt
                                    }
                                  }
            };

            string jsonPayload = JsonConvert.SerializeObject(aiPayload, Formatting.None);
            WriteAiLog(userPrompt, jsonPayload);

            return jsonPayload;
        }

        private string GetUserPrompt(ClientRequest queryInput)
        {
            string questionPrompt = GetQuestionPrompt(queryInput.QuestionId);
            string dataFromClient = GetDataFromClient(queryInput.ClientContextData);
            object dataFromLogic = GetDataFromLogic(queryInput);
            string formattedLogicContext = FormatLogicContextForPrompt(dataFromLogic);


            var promptParts = new[]
            {
                questionPrompt,
                formattedLogicContext,
                dataFromClient
            };
            return string.Join(Environment.NewLine,
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

            var stopWatch = Stopwatch.StartNew();
            var response = await SendWithRetryAsync(AiApiUrl, chatRequestPayload);
            stopWatch.Stop();
            //TODO OPEN
            // Log.Trace($"time taken isn sec  = {stopWatch.Elapsed.TotalSeconds}");
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

        private async Task<ActionResult> StreamToClientAsync(string chatRequestPayload)
        {
            var response = await SendWithRetryAsync(AiApiUrl, chatRequestPayload);
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                WriteAiResponseLog(response.StatusCode, errorBody);
                return Json(new ChatResponse { success = false, reply = $"AI provider API error (status: {(int)response.StatusCode})" });
            }

            Response.BufferOutput = false;
            Response.ContentType = "text/event-stream";
            Response.ContentEncoding = Encoding.UTF8;

            var rawBuilder = new StringBuilder();
            using (var stream = await response.Content.ReadAsStreamAsync())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                while (!reader.EndOfStream)
                {
                    var line = await reader.ReadLineAsync();
                    if (line == null)
                    {
                        continue;
                    }

                    rawBuilder.AppendLine(line);
                    if (!line.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    Response.Write(line + "\n\n");
                    Response.Flush();
                }
            }

            WriteAiResponseLog(response.StatusCode, rawBuilder.ToString());
            return new EmptyResult();
        }

        private string ExtractReplyFromCurrentProvider(JObject aiResult)
        {
            string msg = aiResult["choices"]?[0]?["message"]?["content"]?.ToString();
            if (string.IsNullOrWhiteSpace(msg))
            {
                return "לא ניתן לחלץ את המחרוזת משירות ה AI ";
            }
            else
            {
                return msg;
            }


        }

        private async Task<HttpResponseMessage> SendWithRetryAsync(string url, string jsonPayload)
        {
            const int maxRetries = 2;
            const int retryDelayMs = 900;

            HttpResponseMessage response = null;
            var totalAttempts = maxRetries + 1;

            for (var attempt = 1; attempt <= totalAttempts; attempt++)
            {
                using (var request = new HttpRequestMessage(HttpMethod.Post, url))
                {
                    try
                    {
                        request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
                        response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                    }
                    catch (HttpRequestException)
                    {
                        // Log.Error(request exception);
                        if (attempt == totalAttempts)
                        {
                            throw;
                        }
                    }
                }
                var shouldRetry = response.StatusCode == HttpStatusCode.ServiceUnavailable || (int)response.StatusCode == 429;
                if (!shouldRetry || attempt == totalAttempts)
                {
                    return response;
                }
                else
                {
                    // Log.Trace($"shouldRetry - {attempt}");
                    await Task.Delay(retryDelayMs * attempt);
                }
            }

            return response;
        }



        private object GetDataFromLogic(ClientRequest clientRequest)
        {
            if (!IsServerContextFromLogicEnabled(clientRequest.QuestionId))
            {
                return null;
            }

            switch (clientRequest.QuestionId)
            {
                case "createRecommantionTemplate":
                    return _chatbotLogic.CreateRecommandationTemplate(clientRequest.SubjectId);
                case "getPrevLicensesHistory":
                    return _chatbotLogic.getPrevLicensesHistory(clientRequest.SubjectId);
                case "opionionsSummary":
                    return _chatbotLogic.GetOpinionsSumamry(clientRequest.SubjectId);
                case "validateTotRecommandation":
                    return _chatbotLogic.ValidateTotRecommandation(clientRequest.SubjectId, "xxx");
                default:
                    return null;
            }
        }






        private string GetSystemPrompt()
        {
            return System.IO.File.ReadAllText(Server.MapPath(string.Format($"{PromptTemplateRelativePath}/system-prompt.md")), Encoding.UTF8);
        }


        private string GetQuestionPrompt(string questionId)
        {
            return System.IO.File.ReadAllText(Server.MapPath(string.Format($"{PromptTemplateRelativePath}/{questionId}.md")), Encoding.UTF8);
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
                Directory.CreateDirectory(Path.GetDirectoryName(AiLogFilePath));
                System.IO.File.AppendAllText(AiLogFilePath, logBuilder.ToString(), Encoding.UTF8);
            }
            catch (Exception)
            {
                // Log.Error(write ai log exception);
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
                logBuilder.AppendLine("StatusCode: " + (int)statusCode + " (" + statusCode + ")");

                var tokenUsage = ExtractTokenUsage(responseBody);
                if (tokenUsage != null)
                {
                    logBuilder.AppendLine("PromptTokens: " + tokenUsage.PromptTokens);
                    logBuilder.AppendLine("CompletionTokens: " + tokenUsage.CompletionTokens);
                    logBuilder.AppendLine("TotalTokens: " + tokenUsage.TotalTokens);
                }

                logBuilder.AppendLine("Body:");
                logBuilder.AppendLine(responseBody ?? string.Empty);
                logBuilder.AppendLine();

                Directory.CreateDirectory(Path.GetDirectoryName(AiLogFilePath));
                System.IO.File.AppendAllText(AiLogFilePath, logBuilder.ToString(), Encoding.UTF8);
            }
            catch
            {
                // Logging should never break chat flow.
            }
        }

        private TokenUsageInfo ExtractTokenUsage(string responseBody)
        {
            if (string.IsNullOrWhiteSpace(responseBody))
            {
                return null;
            }

            try
            {
                var json = JObject.Parse(responseBody);
                var usage = json["usage"];
                if (usage == null)
                {
                    return null;
                }

                var promptTokens = usage.Value<int?>("prompt_tokens") ?? usage.Value<int?>("input_tokens") ?? 0;
                var completionTokens = usage.Value<int?>("completion_tokens") ?? usage.Value<int?>("output_tokens") ?? 0;
                var totalTokens = usage.Value<int?>("total_tokens") ?? (promptTokens + completionTokens);

                return new TokenUsageInfo
                {
                    PromptTokens = promptTokens,
                    CompletionTokens = completionTokens,
                    TotalTokens = totalTokens
                };
            }
            catch
            {
                return null;
            }
        }

        private class TokenUsageInfo
        {
            public int PromptTokens { get; set; }
            public int CompletionTokens { get; set; }
            public int TotalTokens { get; set; }
        }
    }
}
