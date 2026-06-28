using Newtonsoft.Json;
using System.Collections.Generic;

namespace Site.Models
{
    public class Question
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("text")]
        public string Text { get; set; }

        [JsonProperty("serverContextFromLogic")]
        public bool ServerContextFromLogic { get; set; }

        [JsonProperty("isOpenQuestion")]
        public bool IsOpenQuestion { get; set; } = false;
       

        [JsonProperty("clientContextSelectors")]
        public List<string> ClientContextSelectors { get; set; }

        [JsonProperty("questionExtended")]
        public string QuestionExtended { get; set; }
    }
}
