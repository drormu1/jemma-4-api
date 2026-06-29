using Newtonsoft.Json;
using Newtonsoft.Json;
using System.Collections.Generic;

namespace Site.ChatBot.Models
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

        [JsonProperty("stream")]
        public bool? Stream { get; set; }
      
    }
}
