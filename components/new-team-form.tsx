"use client";

import { newTeam } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import TagInput from "./tag-input";

const schema = z.object({
  name: z.string().min(3),
  emailInvites: z.array(z.string().email()),
});

export default function NewTeamForm() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      emailInvites: [],
    },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    console.log(values);
    startTransition(async () => {
      const res = await newTeam(values.name, values.emailInvites);
      router.push(`/${res.slug}`);
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mx-auto max-w-lg space-y-8"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Team name" {...field} />
              </FormControl>
              <FormDescription>
                Team name must be unique and be at least three characters long.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="emailInvites"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Invite emails</FormLabel>
              <FormControl>
                <TagInput
                  id="emails"
                  placeholder="Email addresses"
                  tags={form.getValues().emailInvites}
                  setTags={(tags) => {
                    form.setValue("emailInvites", tags);
                    // form.trigger("emailInvites");
                  }}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Optionally enter a comma-separated list of email addresses to
                invite others to your new Team.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          Submit
        </Button>
      </form>
    </Form>
  );
}