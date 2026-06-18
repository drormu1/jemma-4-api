using Newtonsoft.Json;
using System.Collections.Generic;

namespace Mod.CommissionsNG.Web45.ChatBot.Models
{
    public class Questions
    {
        [JsonProperty("questions")]
        public List<Question> Items { get; set; } = new List<Question>();
    }
}
