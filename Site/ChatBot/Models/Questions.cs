using Newtonsoft.Json;
using Newtonsoft.Json;
using System.Collections.Generic;

namespace Site.ChatBot.Models
{
    public class Questions
    {
        [JsonProperty("questions")]
        public List<Question> Items { get; set; } = new List<Question>();
    }
}
