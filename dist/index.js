async function run() {
  const core = require("@actions/core");
  try {
    // Fetch all the inputs
    const token = core.getInput('token');
    const repository = core.getInput('repository');
    const retain_days = core.getInput('retain_days');
    const keep_minimum_runs = core.getInput('keep_minimum_runs');
    const workflow_names = core.getInput('workflow_names');

    // Split the input 'repository' (format {owner}/{repo}) to be {owner} and {repo}
    const splitRepository = repository.split('/');
    if (splitRepository.length !== 2 || !splitRepository[0] || !splitRepository[1]) {
      throw new Error(`Invalid repository '${repository}'. Expected format {owner}/{repo}.`);
    }
    const repo_owner = splitRepository[0];
    const repo_name = splitRepository[1];
    var wf_names = [];
    var wf_ids = [];
    if(workflow_names.length > 0) {
      wf_names = workflow_names.split('\n');
      console.log("💡 Only runs of the following workflows will be processed: " + wf_names.join(','))
    }
    
    var del_runs = new Object();
    const { Octokit } = require("@octokit/rest");
    const { GITHUB_API_URL } = process.env
    const octokit = new Octokit({ auth: token, baseUrl: GITHUB_API_URL});
    var page_number;

    page_number = 1;
    while (true) {
      let response = await octokit.actions.listRepoWorkflows({
        owner: repo_owner,
        repo: repo_name,
        per_page: 100,
        page: page_number
      });
      
      let length = response.data.workflows.length;
      
      if (length < 1) {
        break;
      }
      else {
        for (index = 0; index < length; index++) {
          if(wf_names.length == 0 && !del_runs.hasOwnProperty(response.data.workflows[index].id)) {
            del_runs[response.data.workflows[index].id] = new Array();
            del_runs[response.data.workflows[index].id].gh_wf_name = response.data.workflows[index].name;
            wf_ids.push(response.data.workflows[index].id);
            console.log(`💡 Registering workflow id ${response.data.workflows[index].id} (${response.data.workflows[index].name})`);
          }
          else if(wf_names.includes(response.data.workflows[index].name) && !del_runs.hasOwnProperty(response.data.workflows[index].id)) {
            del_runs[response.data.workflows[index].id] = new Array();
            del_runs[response.data.workflows[index].id].gh_wf_name = response.data.workflows[index].name;
            wf_ids.push(response.data.workflows[index].id);
            console.log(`💡 Registering workflow id ${response.data.workflows[index].id} (${response.data.workflows[index].name})`);
          }
        }
      }

      if (length < 100) {
        break;
      }
      page_number++;
    }

    page_number = 1;
    while (true) {      
      let response = await octokit.actions.listWorkflowRunsForRepo({
        owner: repo_owner,
        repo: repo_name,
        per_page: 100,
        page: page_number
      });
      
      let length = response.data.workflow_runs.length;
      
      if (length < 1) {
        break;
      }
      else {
        for (index = 0; index < length; index++) {
          if(wf_ids.length > 0 && !wf_ids.includes(response.data.workflow_runs[index].workflow_id)) {
            continue;
          }

          core.debug(`run id=${response.data.workflow_runs[index].id} status=${response.data.workflow_runs[index].status}`)

          if(response.data.workflow_runs[index].status !== "completed") {
            console.log(`👻 Skipped workflow run ${response.data.workflow_runs[index].id} (${response.data.workflow_runs[index].name}) is in ${response.data.workflow_runs[index].status} state`);
            continue;
          }

          var created_at = new Date(response.data.workflow_runs[index].created_at);
          var current = new Date();
          var ELAPSE_ms = current.getTime() - created_at.getTime();
          var ELAPSE_days = ELAPSE_ms / (1000 * 3600 * 24);
          
          if (ELAPSE_days >= retain_days) {
            del_runs[response.data.workflow_runs[index].workflow_id].push({ id:response.data.workflow_runs[index].id, name:response.data.workflow_runs[index].name, workflow_id:response.data.workflow_runs[index].workflow_id});
          }
        }
      }
      
      if (length < 100) {
        break;
      }
      page_number++;
    }
    
    for(var i in del_runs) {
      var wfruns = del_runs[i];      
      console.log(`💡 Processing runs of workflow ${i} (${wfruns.gh_wf_name})`);
      const arr_length = wfruns.length //- keep_minimum_runs;
      if (arr_length < 1) {
        console.log(`No workflow runs need to be deleted.`);
      }
      else {
        for (index = 0; index < arr_length; index++) {
          // Execute the API "Delete a workflow run", see 'https://octokit.github.io/rest.js/v18#actions-delete-workflow-run'
          const run_id = wfruns[index].id;
          const run_name = wfruns[index].name;

          core.debug(`Deleting workflow run ${run_id}`);

          await octokit.actions.deleteWorkflowRun({
            owner: repo_owner,
            repo: repo_name,
            run_id: run_id
          });

          console.log(`🧹 Delete workflow run ${run_id} (${run_name})`);
        }

        console.log(`✅ ${arr_length} workflow runs are deleted.`);
      }
    }
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run();
