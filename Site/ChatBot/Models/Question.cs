using Newtonsoft.Json;
using System.Collections.Generic;

namespace Mod.CommissionsNG.Web45.ChatBot.Models
{
    public class Question
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("text")]
        public string Text { get; set; }

        [JsonProperty("serverContextFromLogic")]
        public bool ServerContextFromLogic { get; set; }

        [JsonProperty("clientContextSelectors")]
        public List<string> ClientContextSelectors { get; set; }

        [JsonProperty("questionExtended")]
        public string QuestionExtended { get; set; }
    }
}
