import modal
from datetime import datetime
import stripe
import requests
import json

# Create a Modal app (replacing Stub)
app = modal.App("daily-growth-updates")
volume = modal.Volume.from_name("growth-metrics-volume", create_if_missing=True)

# Create a Modal image with required dependencies
image = modal.Image.debian_slim().pip_install(["stripe", "requests"])

@app.function(
    image=image,
    schedule=modal.Period(days=1),
    volumes={"/data": volume}
)
def run_daily_growth_update():
    # Get secrets from Modal
    STRIPE_SECRET_KEY_LIVE="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"
    SLACK_TOKEN = "xoxb-5229797501522-8595065934770-gk0kWosbv2MmCFLNPftRvVTY"
    SLACK_CHANNEL = "C08HTA80EN8"

    def get_subscriber_stats():
        try:
            stripe.api_key = STRIPE_SECRET_KEY_LIVE
            subscription_plans = {}
            total_active = 0
            
            # Get subscriptions with pagination
            has_more = True
            starting_after = None
            
            while has_more:
                response = stripe.Subscription.list(
                    status='active',
                    limit=100,
                    starting_after=starting_after,
                    expand=['data.customer']
                )
                
                for sub in response['data']:
                    total_active += 1
                    if sub['items']['data']:
                        plan = sub['items']['data'][0]['plan']
                        plan_name = plan.get('nickname', plan['id'])
                    else:
                        plan_name = "unknown"
                    
                    subscription_plans[plan_name] = subscription_plans.get(plan_name, 0) + 1
                
                has_more = response.get('has_more', False)
                if has_more and response['data']:
                    starting_after = response['data'][-1]['id']
                    
            return total_active, subscription_plans
        
        except Exception as e:
            print(f"Error getting Stripe data: {e}")
            return None, None

    def load_previous_count():
        try:
            with open("/data/previous_count.json", "r") as f:
                return json.load(f)["count"]
        except:
            return None

    def save_current_count(count):
        with open("/data/previous_count.json", "w") as f:
            json.dump({"count": count}, f)

    def format_change(current, previous):
        if previous is None:
            return "N/A"
        change = current - previous
        sign = "+" if change >= 0 else ""
        return f"{sign}{change}"

    def send_to_slack(total_active, subscription_plans):
        # Format the plans breakdown
        plan_breakdown = "\n".join([f"• {plan}: {count}" for plan, count in subscription_plans.items()])
        
        message = {
            "channel": SLACK_CHANNEL,
            "text": "📊 Daily Growth Update",
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "📊 Daily Growth Update",
                        "emoji": True
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Total Active Subscribers:* {total_active}"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Annual Recurring Revenue (ARR):* ${'{:,}'.format(total_active * 12 * 20)}"
                    }
                }
            ]
        }
        
        try:
            response = requests.post(
                "https://slack.com/api/chat.postMessage",
                headers={
                    "Authorization": f"Bearer {SLACK_TOKEN}",
                    "Content-Type": "application/json"
                },
                json=message
            )
            
            if not response.ok:
                print(f"Failed to send to Slack: {response.status_code} - {response.text}")
            else:
                print("Successfully sent to Slack!")
            
        except Exception as e:
            print(f"Error sending to Slack: {e}")

    print(f"Starting daily growth update at {datetime.now()}")
    total_active, subscription_plans = get_subscriber_stats()
    
    if total_active is not None:
        previous_count = load_previous_count()
        change_str = format_change(total_active, previous_count)
        print(f"Found {total_active} active subscribers ({change_str} since yesterday). Sending to Slack...")
        
        # Update the Slack message to include the change
        message = {
            "channel": SLACK_CHANNEL,
            "text": "📊 Daily Growth Update",
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "📊 Daily Growth Update",
                        "emoji": True
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Total Active Subscribers:* {total_active} ({change_str} since yesterday)"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Annual Recurring Revenue (ARR):* ${'{:,}'.format(total_active * 12 * 20)}"
                    }
                }
            ]
        }
        
        send_to_slack(total_active, subscription_plans)
        save_current_count(total_active)
    else:
        print("Failed to fetch subscriber data")

if __name__ == "__main__":
    app.run()
