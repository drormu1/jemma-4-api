using Newtonsoft.Json;
using System.Collections.Generic;

namespace Site.ChatBot.Models
{
    public class ClientRequest
    {
        [JsonProperty("questionId")]
        public string QuestionId { get; set; }

        [JsonProperty("subjectId")]
        public int SubjectId { get; set; }

        [JsonProperty("clientContextData")]
        public Dictionary<string, string> ClientContextData { get; set; } = new Dictionary<string, string>();
    }
}
